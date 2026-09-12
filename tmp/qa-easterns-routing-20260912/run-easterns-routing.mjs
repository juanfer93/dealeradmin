import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = process.env.QA_API_URL || 'http://127.0.0.1:3010';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-easterns-routing-20260912';
const LOCATION_ID = 'xN2LSSl62okzv9GnOJPU';
const NOW = '2026-09-12T15:00:00.000Z';
const DUE = '2026-09-12T15:00:15.000Z';
const DEALERS = {
  rosedale: 'd1111111-1111-1111-1111-111111111111',
  laurel: 'd2222222-2222-2222-2222-222222222222',
  sterling: 'd3333333-3333-3333-3333-333333333333',
};

const pool = new Pool({ connectionString: DB });
const SQL = `SELECT c.id AS conversation_db_id, c.ghl_conversation_id, c.status,
       c.qualification_snapshot, c.location_snapshot, c.next_attempt_at,
       l.id AS lead_id, l.canonical_phone, ld.dealer_id, ld.assigned_dealer_id,
       ld.status AS lead_dealer_status, ld.routing_reason
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
    source: 'easterns',
    channel: 'messenger',
    ghl_used: false,
    neon_used: false,
    real_accounts_used: false,
    hmac_printed: false,
  },
  route_rules: {
    baltimore_round_robin: ['Rosedale', 'Laurel'],
    outside_md_va: 'Rosedale',
    southern_md_round_robin: ['Laurel', 'Sterling'],
    virginia: 'Sterling',
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
    [`${NS}-%`],
  )).rows.filter((event) => event.event_id.includes(conversationId.split(`${NS}-`)[1] || conversationId));
  return { rows, messages, events, sql: SQL };
}

async function inbound(c, body, index) {
  const eventId = `${c.case_id}-event-${String(index).padStart(2, '0')}`;
  const messageId = `${c.case_id}-message-${String(index).padStart(2, '0')}`;
  const payload = {
    event_id: eventId,
    event_type: 'customer.replied',
    ghl_message_id: messageId,
    ghl_contact_id: c.contact_id,
    ghl_conversation_id: c.conversation_id,
    message_body: body,
    contact_phone: c.phone,
    contact_name: c.contact_name,
    channel: 'messenger',
    occurred_at: NOW,
  };
  const raw = JSON.stringify(payload);
  const response = await fetch(`${API}/api/webhooks/ghl/customer-replied/easterns`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`,
      'X-DealerADMIN-Test-Now': NOW,
    },
    body: raw,
  });
  const text = await response.text();
  let responseBody;
  try { responseBody = JSON.parse(text); } catch { responseBody = { raw: text }; }
  const after = await state(c.conversation_id);
  c.steps.push({
    index,
    payload: { ...payload, signature: '[redacted]' },
    payload_hash: sha256(raw),
    event_id: eventId,
    message_ids: after.messages.map((message) => message.id),
    response: { http_status: response.status, body: responseBody },
    state_after: after,
  });
  return response.status;
}

async function processDue() {
  const response = await fetch(`${API}/api/webhooks/ghl/conversations/process-due`, {
    method: 'POST',
    headers: { 'X-DealerADMIN-Webhook-Secret': HMAC, 'X-DealerADMIN-Test-Now': DUE },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  const result = { at: DUE, http_status: response.status, body };
  evidence.checks.push({ check: 'simulated_15_seconds_poll', result });
  return result;
}

async function resetNamespace() {
  await pool.query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ghl_conversation_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
}

async function runCase(spec) {
  const c = {
    case_id: `${NS}-${spec.key}`,
    label: spec.label,
    city: spec.city,
    state: spec.state,
    expected_dealer: spec.expected,
    source: 'easterns',
    channel: 'messenger',
    location_id: LOCATION_ID,
    contact_id: `${NS}-${spec.key}-contact`,
    conversation_id: `${NS}-${spec.key}-conversation`,
    contact_name: spec.contact_name,
    phone: `+12405553${String(100 + evidence.cases.length).padStart(3, '0')}`,
    steps: [],
  };
  const before = await state(c.conversation_id);
  const messages = [
    `Me llamo ${c.contact_name}`,
    'busco un Mustang',
    'tengo 1000 de enganche',
    'compro esta semana',
    `Estoy en ${spec.city}, ${spec.state}`,
  ];
  for (let index = 0; index < messages.length; index += 1) await inbound(c, messages[index], index + 1);
  const beforePoll = await state(c.conversation_id);
  c.before_poll = beforePoll;
  await processDue();
  const after = await state(c.conversation_id);
  const row = after.rows[0] || {};
  const assigned = row.assigned_dealer_id || row.dealer_id || null;
  c.before = before;
  c.after = after;
  c.status_after = row.status ?? null;
  c.snapshot_after = row.qualification_snapshot ?? null;
  c.location_snapshot = row.location_snapshot ?? null;
  c.message_ids = after.messages.map((message) => message.id);
  c.event_ids = c.steps.map((step) => step.event_id);
  c.payload_hashes = c.steps.map((step) => step.payload_hash);
  c.assigned_dealer_id = assigned;
  c.routing_reason = row.routing_reason ?? null;
  c.next_attempt_at = row.next_attempt_at ?? null;
  c.sql_verification = SQL;
  c.result = assigned === spec.expected && row.status === 'queued' && c.location_snapshot?.city === spec.city && c.location_snapshot?.state === spec.state ? 'PASS' : 'FAIL';
  c.assertion = c.result === 'PASS' ? `assigned ${assigned} with expected ${spec.expected}` : `assigned ${assigned}, status ${row.status}, location ${JSON.stringify(c.location_snapshot)}`;
  evidence.cases.push(c);
}

async function main() {
  await pool.query('SELECT 1');
  await resetNamespace();
  evidence.baseline = {
    migration: (await pool.query('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1')).rows[0]?.name,
    easterns_dealers: (await pool.query(`SELECT id, code, name, ghl_location_id FROM dealers WHERE id = ANY($1::uuid[]) ORDER BY code`, [[DEALERS.rosedale, DEALERS.laurel, DEALERS.sterling]])).rows,
    prior_baltimore_overlap: (await pool.query(`SELECT assigned_dealer_id, routing_reason FROM lead_dealers WHERE routing_reason LIKE 'Baltimore Overlap:%' ORDER BY created_at DESC LIMIT 1`)).rows,
    prior_southern_overlap: (await pool.query(`SELECT assigned_dealer_id, routing_reason FROM lead_dealers WHERE routing_reason LIKE 'Southern MD/DC Overlap:%' ORDER BY created_at DESC LIMIT 1`)).rows,
  };

  for (const spec of [
    { key: 'baltimore-1', label: 'Baltimore first', contact_name: 'Buyer Uno', city: 'Baltimore', state: 'MD', expected: DEALERS.rosedale },
    { key: 'baltimore-2', label: 'Baltimore second', contact_name: 'Buyer Dos', city: 'Baltimore', state: 'MD', expected: DEALERS.laurel },
    { key: 'new-jersey', label: 'New Jersey outside MD/VA', contact_name: 'Buyer Tres', city: 'Newark', state: 'NJ', expected: DEALERS.rosedale },
    { key: 'silver-spring', label: 'Silver Spring', contact_name: 'Buyer Cuatro', city: 'Silver Spring', state: 'MD', expected: DEALERS.laurel },
    { key: 'washington', label: 'Washington DC', contact_name: 'Buyer Cinco', city: 'Washington', state: 'DC', expected: DEALERS.sterling },
    { key: 'southern-md-1', label: 'Southern Maryland first', contact_name: 'Buyer Seis', city: 'Waldorf', state: 'MD', expected: DEALERS.laurel },
    { key: 'southern-md-2', label: 'Southern Maryland second', contact_name: 'Buyer Siete', city: 'La Plata', state: 'MD', expected: DEALERS.sterling },
    { key: 'virginia', label: 'Virginia', contact_name: 'Buyer Ocho', city: 'Richmond', state: 'VA', expected: DEALERS.sterling },
  ]) await runCase(spec);

  const pass = evidence.cases.filter((item) => item.result === 'PASS').length;
  const fail = evidence.cases.filter((item) => item.result === 'FAIL').length;
  evidence.summary = { pass, fail, blocked: 0, total_cases: evidence.cases.length, all_pass: fail === 0 };
  await mkdir('tmp/qa-easterns-routing-20260912', { recursive: true });
  await writeFile('tmp/qa-easterns-routing-20260912/evidence.json', JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.summary));
  if (fail) process.exitCode = 2;
}

main().catch(async (error) => {
  await writeFile('tmp/qa-easterns-routing-20260912/fatal.json', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2), 'utf8');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => pool.end());
