import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = 'http://127.0.0.1:3021';
const DB = 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-amin-stafford-20260913';
const contactId = `${NS}-contact`;
const conversationId = `${NS}-conversation`;
const messages = [
  ['Saludos', '2026-09-14T18:26:50.220Z'],
  ['Amin', '2026-09-14T18:27:21.795Z'],
  ['Busco carro del 2019 en adelante', '2026-09-14T18:27:26.460Z'],
  ['Sedan', '2026-09-14T18:28:47.036Z'],
  ['500$', '2026-09-14T18:29:36.302Z'],
];
const pool = new Pool({ connectionString: DB });
const SQL = `SELECT c.id AS conversation_db_id, c.status, c.qualification_snapshot,
    c.location_snapshot, c.ready_at, c.next_attempt_at,
    l.id AS lead_id, l.canonical_phone, l.first_name, l.last_name,
    ld.dealer_id, ld.assigned_dealer_id, ld.status AS lead_dealer_status,
    ld.routing_reason
  FROM conversations c JOIN leads l ON l.id = c.lead_id
  LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
  WHERE c.ghl_conversation_id = $1 ORDER BY ld.created_at NULLS LAST`;

async function reset() {
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)`, [contactId]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id = $1`, [contactId]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id = $1`, [contactId]);
}
async function snapshot() {
  const rows = (await pool.query(SQL, [conversationId])).rows;
  const dbId = rows[0]?.conversation_db_id;
  const conversationMessages = dbId ? (await pool.query(`SELECT id, ghl_message_id, direction, body, occurred_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at, created_at`, [dbId])).rows : [];
  const events = (await pool.query(`SELECT event_id, status, payload_hash, ghl_location_id FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id`, [`${NS}%`])).rows;
  return { rows, messages: conversationMessages, events, sql: SQL };
}
async function webhook(index, body, occurredAt) {
  const payload = {
    event_id: `${NS}-event-${String(index).padStart(2, '0')}`,
    event_type: 'customer.replied',
    ghl_message_id: `${NS}-message-${String(index).padStart(2, '0')}`,
    ghl_contact_id: contactId,
    ghl_conversation_id: conversationId,
    message_body: body,
    contact_phone: '(929) 756-3553',
    contact_name: '~',
    channel: 'whatsapp',
    occurred_at: occurredAt,
  };
  const raw = JSON.stringify(payload);
  const response = await fetch(`${API}/api/webhooks/ghl/customer-replied/stafford`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`, 'X-DealerADMIN-Test-Now': occurredAt },
    body: raw,
  });
  return { payload, payload_hash: createHash('sha256').update(raw).digest('hex'), http_status: response.status, body: await response.json() };
}
async function poll(at) {
  const response = await fetch(`${API}/api/webhooks/ghl/conversations/process-due`, { method: 'POST', headers: { 'X-GHL-Webhook-Secret': HMAC, 'X-DealerADMIN-Webhook-Secret': HMAC, 'X-DealerADMIN-Test-Now': at } });
  return { at, http_status: response.status, body: await response.json() };
}

await reset();
const before = await snapshot();
const steps = [];
for (const [index, [body, at]] of messages.entries()) {
  const response = await webhook(index + 1, body, at);
  steps.push({ body, at, response, after: await snapshot() });
}
const afterCapture = await snapshot();
const stabilization = await poll('2026-09-14T18:30:00.000Z');
const beforeRelease = await snapshot();
const release = await poll('2026-09-14T18:59:36.302Z');
const afterRelease = await snapshot();
const row = afterRelease.rows[0] ?? {};
const snapshotAfter = row.qualification_snapshot ?? {};
const progress = snapshotAfter.qualification_progress ?? {};
const assertions = {
  normalized_name: snapshotAfter.real_name === 'Amin' && row.first_name === 'Amin',
  normalized_vehicle: snapshotAfter.vehicle_type === 'Sedan',
  normalized_down: snapshotAfter.down_payment === '500',
  next_question_uses_remaining_fact: progress.step === 'purchase_timeline' && progress.predicted_bot_question === '¿Cuándo planeas comprar?',
  capture_waits: afterCapture.rows[0]?.status === 'waiting_window',
  release_queues: row.status === 'queued' && row.next_attempt_at === null,
  linked_messages: afterRelease.messages.length === messages.length,
  linked_events: afterRelease.events.length === messages.length && afterRelease.events.every((event) => event.status === 'processed'),
  dealer_assignment: afterRelease.rows.some((item) => item.dealer_id || item.assigned_dealer_id),
};
const evidence = {
  run_id: NS,
  generated_at: new Date().toISOString(),
  environment: { api_url: API, database: 'local PostgreSQL in user-provided Docker container', timezone: 'America/Bogota', secret_printed: false },
  case: { source: 'stafford', channel: 'whatsapp', conversation_id: conversationId, before, steps, after_capture: afterCapture, stabilization, before_release: beforeRelease, release, after_release: afterRelease, verification_sql: SQL, assertions, result: Object.values(assertions).every(Boolean) ? 'PASS' : 'FAIL' },
};
await mkdir(`tmp/${NS}`, { recursive: true });
await writeFile(`tmp/${NS}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ result: evidence.case.result, assertions, final: { status: row.status, real_name: snapshotAfter.real_name, vehicle_type: snapshotAfter.vehicle_type, down_payment: snapshotAfter.down_payment, step: progress.step, predicted_bot_question: progress.predicted_bot_question, message_count: afterRelease.messages.length, event_count: afterRelease.events.length } }, null, 2));
await pool.end();
if (evidence.case.result !== 'PASS') process.exitCode = 1;
