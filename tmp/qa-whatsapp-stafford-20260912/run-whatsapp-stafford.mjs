import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');

const API = process.env.QA_API_URL || 'http://127.0.0.1:3010';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-whatsapp-stafford-20260912';
const LOCATION_ID = 'LiaoSID3nvAhad49ZpNJ';
const DAY_10 = '2026-09-12T15:00:00.000Z';
const DAY_10_15S = '2026-09-12T15:00:15.000Z';
const DAY_10_30M = '2026-09-12T15:30:00.000Z';
const NIGHT_20 = '2026-09-13T01:00:00.000Z';
const NIGHT_20_15S = '2026-09-13T01:00:15.000Z';
const NIGHT_23 = '2026-09-13T04:00:00.000Z';

const pool = new Pool({ connectionString: DB });
const SQL = `SELECT c.id AS conversation_db_id, c.ghl_conversation_id, c.channel, c.status,
       c.qualification_snapshot, c.location_snapshot, c.next_attempt_at, c.ready_at,
       l.id AS lead_id, l.canonical_phone, l.first_name, l.last_name,
       ld.dealer_id, ld.assigned_dealer_id, ld.status AS lead_dealer_status, ld.routing_reason
     FROM conversations c
     JOIN leads l ON l.id = c.lead_id
     LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE c.ghl_conversation_id = $1
     ORDER BY ld.created_at NULLS LAST`;

const evidence = {
  run_id: NS,
  generated_at: new Date().toISOString(),
  environment: {
    api_url: API,
    database: 'local PostgreSQL in user-provided Docker container',
    timezone: 'America/Bogota',
    channel: 'whatsapp',
    source: 'stafford',
    ghl_used: false,
    neon_used: false,
    real_accounts_used: false,
    hmac_printed: false,
  },
  acceptance: {
    minimum_for_whatsapp: 'existing phone plus backend-interpreted vehicle',
    incomplete_in_business_hours: 'released to local frontend after simulated 30 minutes',
    incomplete_outside_business_hours: 'released to local frontend after simulated 3 hours',
    stabilization: 'simulated 15 seconds',
  },
  cases: [],
  checks: [],
};

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

async function state(conversationId) {
  const rows = (await pool.query(SQL, [conversationId])).rows;
  const messages = (await pool.query(
    `SELECT id, ghl_message_id, dedupe_key, direction, body, occurred_at
     FROM conversation_messages
     WHERE conversation_id = (SELECT id FROM conversations WHERE ghl_conversation_id = $1)
     ORDER BY occurred_at, created_at`,
    [conversationId],
  )).rows;
  const events = (await pool.query(
    `SELECT event_id, status, payload_hash, error_code, ghl_location_id
     FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id`,
    [`${NS}-${conversationId.split(`${NS}-`)[1] || conversationId}-%`],
  )).rows;
  return { rows, messages, events, sql: SQL };
}

async function postWebhook(payload, now) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`;
  const response = await fetch(`${API}/api/webhooks/ghl/customer-replied/stafford`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': signature,
      'X-DealerADMIN-Test-Now': now,
    },
    body: raw,
  });
  const responseText = await response.text();
  let body;
  try { body = JSON.parse(responseText); } catch { body = { raw: responseText }; }
  return { raw, payload_hash: sha256(raw), http_status: response.status, body };
}

function createCase(id, phone, contactName = 'WhatsApp Contact') {
  return {
    case_id: `${NS}-${id}`,
    source: 'stafford',
    channel: 'whatsapp',
    location_id: LOCATION_ID,
    contact_id: `${NS}-${id}-contact`,
    conversation_id: `${NS}-${id}-conversation`,
    phone,
    contact_name: contactName,
    steps: [],
  };
}

async function inbound(c, body, index, now, phone = c.phone) {
  const eventId = `${c.case_id}-event-${String(index).padStart(2, '0')}`;
  const messageId = `${c.case_id}-message-${String(index).padStart(2, '0')}`;
  const payload = {
    event_id: eventId,
    event_type: 'customer.replied',
    ghl_message_id: messageId,
    ghl_contact_id: c.contact_id,
    ghl_conversation_id: c.conversation_id,
    message_body: body,
    contact_phone: phone,
    contact_name: c.contact_name,
    channel: 'whatsapp',
    occurred_at: now,
  };
  const delivery = await postWebhook(payload, now);
  const after = await state(c.conversation_id);
  c.steps.push({
    index,
    payload: { ...payload, signature: '[redacted]' },
    payload_hash: delivery.payload_hash,
    event_id: eventId,
    message_ids: after.messages.map((message) => message.id),
    response: delivery,
    after,
    snapshot_after: after.rows[0]?.qualification_snapshot ?? null,
    state_after: after.rows[0]?.status ?? null,
  });
  return delivery;
}

async function processDue(now) {
  const response = await fetch(`${API}/api/webhooks/ghl/conversations/process-due`, {
    method: 'POST',
    // The due endpoint has no JSON body to sign; use the same injected local
    // shared-secret transport accepted by the real webhook guard.
    headers: { 'X-DealerADMIN-Webhook-Secret': HMAC, 'X-DealerADMIN-Test-Now': now },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  const result = { now, http_status: response.status, body };
  evidence.checks.push({ check: `process_due_${now}`, result });
  return result;
}

async function finish(c, before, after, expected, assertion) {
  const row = after.rows[0] ?? {};
  c.before = before;
  c.after = after;
  c.status_before = before.rows[0]?.status ?? null;
  c.status_after = row.status ?? null;
  c.snapshot_before = before.rows[0]?.qualification_snapshot ?? null;
  c.snapshot_after = row.qualification_snapshot ?? null;
  c.location_snapshot = row.location_snapshot ?? null;
  c.dealer_assigned = after.rows.map((item) => item.assigned_dealer_id || item.dealer_id).filter(Boolean);
  c.next_attempt_at = row.next_attempt_at ?? null;
  c.routing_reason = after.rows.map((item) => item.routing_reason).filter(Boolean);
  c.message_ids = after.messages.map((message) => message.id);
  c.event_ids = after.events.map((event) => event.event_id);
  c.payload_hashes = c.steps.map((step) => step.payload_hash);
  c.sql_verification = SQL;
  c.expected = expected;
  c.assertion = assertion;
  c.result = assertion ? 'PASS' : 'FAIL';
  evidence.cases.push(c);
  return assertion;
}

async function resetNamespace() {
  await pool.query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ghl_conversation_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
}

async function runIncomplete(c, messages, start, stabilization, release, expectedStatus) {
  const before = await state(c.conversation_id);
  for (let i = 0; i < messages.length; i += 1) await inbound(c, messages[i], i + 1, start);
  const afterStabilization = await state(c.conversation_id);
  c.stabilization = { at: stabilization, before_poll: afterStabilization };
  await processDue(stabilization);
  const afterWindow = await state(c.conversation_id);
  c.window_wait = { release_at: release, before_release: afterWindow };
  if (release) await processDue(release);
  const after = await state(c.conversation_id);
  return finish(c, before, after, { status: expectedStatus, start, stabilization, release }, Boolean(after.rows[0]?.status === expectedStatus));
}

async function main() {
  await pool.query('SELECT 1');
  await resetNamespace();

  evidence.baseline = {
    migration: (await pool.query('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1')).rows[0]?.name,
    schema: (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`)).rows.map((row) => row.table_name),
    container_scope: 'c20d4b05ae50be641c04709c5bff0b91ef3229abbab50e669115e175b2c6144e / dealeradmin-postgres / postgres:18',
  };

  const day = createCase('day-vehicle-only', '+12405552001');
  await runIncomplete(day, ['¿Qué requisitos necesito?', 'busco un Mustang'], DAY_10, DAY_10_15S, DAY_10_30M, 'queued');

  const night = createCase('night-vehicle-only', '+12405552002');
  await runIncomplete(night, ['busco un truck'], NIGHT_20, NIGHT_20_15S, NIGHT_23, 'queued');

  const noVehicle = createCase('phone-without-vehicle', '+12405552003');
  const beforeNoVehicle = await state(noVehicle.conversation_id);
  await inbound(noVehicle, 'Hola, quiero información', 1, DAY_10);
  await processDue(DAY_10_15S);
  await processDue(DAY_10_30M);
  const afterNoVehicle = await state(noVehicle.conversation_id);
  await finish(noVehicle, beforeNoVehicle, afterNoVehicle, { status: 'partial', no_lead_dealer: true }, Boolean(afterNoVehicle.rows[0]?.status === 'partial' && afterNoVehicle.rows.every((row) => !row.dealer_id)));

  const declaration = createCase('declared-name-and-vehicle', '+12405552004');
  const beforeDeclaration = await state(declaration.conversation_id);
  await inbound(declaration, 'Me llamo Sofia Stafford', 1, DAY_10);
  await inbound(declaration, 'quiero una Honda Civic', 2, DAY_10);
  const afterDeclaration = await state(declaration.conversation_id);
  await finish(declaration, beforeDeclaration, afterDeclaration, { real_name: 'Sofia Stafford', vehicle_type: 'Honda Civic', status: 'waiting_window' }, Boolean(afterDeclaration.rows[0]?.qualification_snapshot?.real_name === 'Sofia Stafford' && afterDeclaration.rows[0]?.qualification_snapshot?.vehicle_type === 'Honda Civic' && afterDeclaration.rows[0]?.status === 'waiting_window'));

  const contamination = createCase('contaminated-replies', '+12405552005', 'WhatsApp Contact');
  const beforeContamination = await state(contamination.conversation_id);
  await inbound(contamination, '¿Qué requisitos necesito?', 1, DAY_10);
  await inbound(contamination, 'Quiero financiar un auto', 2, DAY_10);
  await inbound(contamination, 'Mustang', 3, DAY_10);
  const afterContamination = await state(contamination.conversation_id);
  await finish(contamination, beforeContamination, afterContamination, { real_name: '', vehicle_type: '', status: 'partial' }, Boolean(!afterContamination.rows[0]?.qualification_snapshot?.real_name && !afterContamination.rows[0]?.qualification_snapshot?.vehicle_type && afterContamination.rows[0]?.status === 'partial'));

  const duplicateEvent = createCase('duplicate-webhook', '+12405552006');
  const beforeDuplicate = await state(duplicateEvent.conversation_id);
  const payloadBody = 'busco un SUV';
  await inbound(duplicateEvent, payloadBody, 1, DAY_10);
  const firstMessageCount = (await state(duplicateEvent.conversation_id)).messages.length;
  const retry = await inbound(duplicateEvent, payloadBody, 1, DAY_10);
  const afterDuplicate = await state(duplicateEvent.conversation_id);
  duplicateEvent.retry_response = retry;
  duplicateEvent.first_message_count = firstMessageCount;
  duplicateEvent.retry_message_count = afterDuplicate.messages.length;
  await finish(duplicateEvent, beforeDuplicate, afterDuplicate, { same_event: 'duplicate_ignored', one_message: true }, Boolean(retry.body?.status === 'duplicate_ignored' && firstMessageCount === afterDuplicate.messages.length));

  const badSignaturePayload = {
    event_id: `${NS}-bad-signature-event`,
    event_type: 'customer.replied',
    ghl_message_id: `${NS}-bad-signature-message`,
    ghl_contact_id: `${NS}-bad-signature-contact`,
    ghl_conversation_id: `${NS}-bad-signature-conversation`,
    message_body: 'busco un Mustang',
    contact_phone: '+12405552007',
    channel: 'whatsapp',
    occurred_at: DAY_10,
  };
  const rawBad = JSON.stringify(badSignaturePayload);
  const badResponse = await fetch(`${API}/api/webhooks/ghl/customer-replied/stafford`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-GHL-Signature': 'sha256=invalid', 'X-DealerADMIN-Test-Now': DAY_10 },
    body: rawBad,
  });
  evidence.checks.push({ check: 'invalid_signature', expected_http: 401, actual_http: badResponse.status });

  const queued = evidence.cases.filter((item) => item.result === 'PASS').length;
  const failed = evidence.cases.filter((item) => item.result === 'FAIL').length;
  const invalidSignaturePass = evidence.checks.some((item) => item.check === 'invalid_signature' && item.actual_http === 401);
  evidence.summary = { pass: queued + (invalidSignaturePass ? 1 : 0), fail: failed + (invalidSignaturePass ? 0 : 1), blocked: 0, total_cases: evidence.cases.length + 1, all_pass: failed === 0 && invalidSignaturePass };
  await mkdir('tmp/qa-whatsapp-stafford-20260912', { recursive: true });
  await writeFile('tmp/qa-whatsapp-stafford-20260912/evidence.json', JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.summary));
  if (!evidence.summary.all_pass) process.exitCode = 2;
}

main().catch(async (error) => {
  await writeFile('tmp/qa-whatsapp-stafford-20260912/fatal.json', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2), 'utf8');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => pool.end());
