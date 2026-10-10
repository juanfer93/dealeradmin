import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = 'http://127.0.0.1:3016';
const DB = 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-marie-flanagan-20260913-webhook-v2';
const conversationId = `${NS}-conversation`;
const contactId = `${NS}-contact`;
const source = 'action-cars';
const messages = [
  ['A small SUV', '', '2026-09-12T23:59:55.000Z'],
  ['But I have down payment', '', '2026-09-13T00:00:00.000Z'],
  ['443 862-6592', '(443) 862-6592', '2026-09-13T00:00:05.000Z'],
  ['Could you do 700?', '(443) 862-6592', '2026-09-13T00:00:10.000Z'],
  ['No I need a car like yesterday!!', '(443) 862-6592', '2026-09-13T00:00:15.000Z'],
];
const pool = new Pool({ connectionString: DB });

async function post(body, now) {
  const raw = JSON.stringify(body);
  const response = await fetch(`${API}/api/webhooks/ghl/customer-replied/${source}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`,
      'X-DealerADMIN-Test-Now': now,
    },
    body: raw,
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

const responses = [];
for (const [index, [body, phone, occurredAt]] of messages.entries()) {
  responses.push(await post({
    event_id: `${NS}-event-${String(index + 1).padStart(2, '0')}`,
    event_type: 'customer.replied',
    ghl_message_id: `${NS}-message-${String(index + 1).padStart(2, '0')}`,
    ghl_contact_id: contactId,
    ghl_conversation_id: conversationId,
    message_body: body,
    contact_phone: phone,
    contact_name: 'Morningstar Marie Flanagan',
    channel: 'messenger',
    occurred_at: occurredAt,
  }, occurredAt));
}

const rows = (await pool.query(`SELECT c.id AS conversation_id, c.status, c.qualification_snapshot,
    c.location_snapshot, c.next_attempt_at, l.canonical_phone, l.first_name, l.last_name,
    ld.dealer_id, ld.assigned_dealer_id, ld.routing_reason
  FROM conversations c JOIN leads l ON l.id = c.lead_id
  LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
  WHERE c.ghl_conversation_id = $1`, [conversationId])).rows;
const row = rows[0] ?? {};
const dbMessages = row.conversation_id
  ? (await pool.query(`SELECT id, ghl_message_id, direction, body, occurred_at
      FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at, created_at`, [row.conversation_id])).rows
  : [];
const events = (await pool.query(`SELECT event_id, status, payload_hash, ghl_location_id
    FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id`, [`${NS}-%`])).rows;
const snapshot = row.qualification_snapshot ?? {};
const result = {
  run_id: NS,
  generated_at: new Date().toISOString(),
  environment: { api_url: API, database: 'local PostgreSQL in user-provided Docker container', timezone: 'America/Bogota', secret_printed: false },
  case: {
    source,
    conversation_id: conversationId,
    message_ids: dbMessages.map((item) => item.ghl_message_id),
    responses,
    db: { row, messages: dbMessages, webhook_events: events },
    verification_sql: 'SELECT conversations JOIN leads LEFT JOIN lead_dealers; SELECT conversation_messages; SELECT webhook_events',
    assertions: {
      phone: row.canonical_phone === '+14438626592',
      vehicle: snapshot.vehicle_type === 'SUV',
      no_false_down_payment: snapshot.down_payment === '' || snapshot.down_payment == null,
      linked_messages: dbMessages.length === messages.length,
      webhook_events: events.length === messages.length,
    },
  },
};
result.case.pass = Object.values(result.case.assertions).every(Boolean);
await writeFile(new URL('./evidence-after-api.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ result: result.case.pass ? 'PASS' : 'FAIL', assertions: result.case.assertions, status: row.status, down_payment: snapshot.down_payment ?? '', vehicle_type: snapshot.vehicle_type ?? '', phone: row.canonical_phone ?? '', message_count: dbMessages.length, event_count: events.length }, null, 2));
await pool.end();
if (!result.case.pass) process.exitCode = 1;
