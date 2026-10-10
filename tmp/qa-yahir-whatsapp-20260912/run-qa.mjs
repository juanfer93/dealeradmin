import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = process.env.QA_API_URL || 'http://127.0.0.1:3015';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-yahir-whatsapp-20260912';
const DAY = '2026-09-12T19:52:00.000Z';
const DAY_30S = '2026-09-12T19:52:30.000Z';
const STAFFORD_LOCATION_ID = 'loc_stafford_789';
const SQL = `SELECT c.id AS conversation_db_id, c.ghl_conversation_id, c.channel, c.status,
       c.qualification_snapshot, c.location_snapshot, c.next_attempt_at,
       l.id AS lead_id, l.canonical_phone, l.first_name, l.last_name,
       ld.dealer_id, ld.assigned_dealer_id, ld.status AS lead_dealer_status,
       ld.routing_reason
     FROM conversations c JOIN leads l ON l.id = c.lead_id
     LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE c.ghl_conversation_id = $1 ORDER BY ld.created_at NULLS LAST`;
const pool = new Pool({ connectionString: DB });
const evidence = {
  run_id: NS,
  generated_at: new Date().toISOString(),
  environment: { api_url: API, database: 'local PostgreSQL in user-provided Docker container', timezone: 'America/Bogota', secret_printed: false },
  cases: [],
};

async function reset() {
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
}

async function dbState(conversationId, eventPrefix = null) {
  const state = (await pool.query(SQL, [conversationId])).rows;
  const dbId = state[0]?.conversation_db_id;
  const messages = dbId ? (await pool.query(`SELECT id, ghl_message_id, direction, body, occurred_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at, created_at`, [dbId])).rows : [];
  const events = eventPrefix ? (await pool.query(`SELECT event_id, status, payload_hash, error_code, ghl_location_id FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id`, [`${eventPrefix}-%`])).rows : [];
  const leadRows = state.map((row) => ({ lead_id: row.lead_id, first_name: row.first_name, last_name: row.last_name, canonical_phone: row.canonical_phone, dealer_id: row.dealer_id, assigned_dealer_id: row.assigned_dealer_id, lead_dealer_status: row.lead_dealer_status, routing_reason: row.routing_reason }));
  return { state, messages, events, leadRows, sql: SQL };
}

function hash(raw) { return createHash('sha256').update(raw).digest('hex'); }

async function post(route, raw, now) {
  const response = await fetch(`${API}${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`,
      'X-DealerADMIN-Test-Now': now,
    },
    body: raw,
  });
  const text = await response.text();
  return { http_status: response.status, body: JSON.parse(text) };
}

async function runCase(id, phone, contactName, bodies, expected) {
  const caseId = `${NS}-${id}`;
  const conversationId = `${caseId}-conversation`;
  const c = { case_id: caseId, source: 'stafford', location_id: STAFFORD_LOCATION_ID, channel: 'whatsapp', phone, contact_name: contactName, conversation_id: conversationId, steps: [] };
  c.before = await dbState(conversationId);
  for (const [index, body] of bodies.entries()) {
    const eventId = `${caseId}-event-${String(index + 1).padStart(2, '0')}`;
    const messageId = `${caseId}-message-${String(index + 1).padStart(2, '0')}`;
    const payload = {
      event_id: eventId,
      event_type: 'customer.replied',
      ghl_message_id: messageId,
      ghl_contact_id: `${caseId}-contact`,
      ghl_conversation_id: conversationId,
      message_body: body,
      contact_phone: phone,
      contact_name: contactName,
      channel: 'whatsapp',
      occurred_at: DAY,
    };
    const raw = JSON.stringify(payload);
    const response = await post(`/api/webhooks/ghl/customer-replied/${c.source}`, raw, DAY);
    const after = await dbState(conversationId, caseId);
    c.steps.push({ event_id: eventId, message_id: messageId, payload_hash: hash(raw), body, response, after });
  }
  c.poll_response = await post('/api/webhooks/ghl/conversations/process-due', '', DAY_30S);
  c.after = await dbState(conversationId, caseId);
  const row = c.after.state[0] ?? {};
  const snapshot = row.qualification_snapshot ?? {};
  const progress = snapshot.qualification_progress ?? {};
  c.assertions = {
    all_webhooks_accepted: c.steps.every((step) => step.response.http_status === 201 && step.response.body.status === 'processed'),
    all_events_processed: c.after.events.length === bodies.length && c.after.events.every((event) => event.status === 'processed'),
    message_count_expected: c.after.messages.length === bodies.length,
    real_name_expected: snapshot.real_name === expected.real_name,
    lead_name_expected: row.first_name === expected.first_name && row.last_name === (expected.last_name ?? ''),
    no_profile_name_contamination: snapshot.real_name !== contactName && !JSON.stringify(snapshot.qualification_memory ?? '').includes(contactName),
    vehicle_expected: snapshot.vehicle_type === expected.vehicle_type,
    down_expected: snapshot.down_payment === expected.down_payment,
    timeline_expected: snapshot.purchase_timeline === expected.purchase_timeline,
    phone_normalized: row.canonical_phone === expected.phone,
    stafford_assigned: row.assigned_dealer_id === expected.dealer_id,
    one_lead_dealer_row: c.after.state.length === 1,
    progress_present: Boolean(progress.step && progress.predicted_bot_question),
  };
  c.result = Object.values(c.assertions).every(Boolean) ? 'PASS' : 'FAIL';
  c.status_before = c.before.state[0]?.status ?? null;
  c.status_after = row.status ?? null;
  c.snapshot_after = snapshot;
  c.location_snapshot = row.location_snapshot ?? {};
  c.next_attempt_at = row.next_attempt_at ?? null;
  c.dealer_assigned = row.assigned_dealer_id ?? row.dealer_id ?? null;
  c.routing_reason = row.routing_reason ?? null;
  c.message_ids = c.after.messages.map((message) => message.id);
  c.event_ids = c.after.events.map((event) => event.event_id);
  c.sql_verification = SQL;
  evidence.cases.push(c);
}

async function main() {
  await pool.query('SELECT 1');
  await reset();
  const stafford = (await pool.query(`SELECT id FROM dealers WHERE ghl_location_id = $1`, [STAFFORD_LOCATION_ID])).rows[0];
  if (!stafford?.id) throw new Error('Local Stafford dealer was not found in the catalog.');
  await runCase('yahir-reproduced', '+18048446382', 'Lo Más Pronto Posible', [
    '*Headline:* Financiamiento inmediato',
    'Yahir',
    'Quiero ver si puedo con 1000',
    'Lo más pronto posible',
    'Que y qué papeles ocupo para aplicar',
    'Sedan',
    'Si sin problema',
    'Si está bien no hay problema',
    'Hoy si gusta',
    'A las 5 si se puede por favor',
  ], { real_name: 'Yahir', first_name: 'Yahir', last_name: '', vehicle_type: 'Sedan', down_payment: '1000', purchase_timeline: 'today', phone: '+18048446382', dealer_id: stafford.id });
  await runCase('compound-name-control', '+18045550123', 'WhatsApp Contact', [
    'Mi nombre es María José López',
    'Estoy buscando una Honda Civic',
    'Puedo poner 2000 de enganche',
    'Esta semana',
  ], { real_name: 'María José López', first_name: 'María', last_name: 'José López', vehicle_type: 'Honda Civic', down_payment: '2000', purchase_timeline: 'this week', phone: '+18045550123', dealer_id: stafford.id });
  evidence.summary = { pass: evidence.cases.filter((item) => item.result === 'PASS').length, fail: evidence.cases.filter((item) => item.result === 'FAIL').length, blocked: 0, total_cases: evidence.cases.length, all_pass: evidence.cases.every((item) => item.result === 'PASS') };
  await mkdir(`tmp/${NS}`, { recursive: true });
  await writeFile(`tmp/${NS}/evidence-final.json`, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.summary));
  await pool.end();
}

main().catch(async (error) => { console.error(error.message); await pool.end(); process.exitCode = 1; });
