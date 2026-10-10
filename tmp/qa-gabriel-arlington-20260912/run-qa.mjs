import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = process.env.QA_API_URL || 'http://127.0.0.1:3015';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-gabriel-arlington-20260912';
const OUT = new URL('./evidence.json', import.meta.url);
const SOURCE = 'arlington';
const LOCATION_ID = '9v8zH9Y5eLiiJwZTZDci';
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
  checks: [],
};

async function reset() {
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
}

async function state(conversationId, eventPrefix = null) {
  const rows = (await pool.query(SQL, [conversationId])).rows;
  const dbId = rows[0]?.conversation_db_id;
  const messages = dbId
    ? (await pool.query(`SELECT id, ghl_message_id, dedupe_key, direction, body, occurred_at
        FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at, created_at`, [dbId])).rows
    : [];
  const events = eventPrefix
    ? (await pool.query(`SELECT event_id, status, payload_hash, error_code, ghl_location_id
        FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id`, [`${eventPrefix}-%`])).rows
    : [];
  return { state: rows, messages, events, sql: SQL };
}

function hash(raw) { return createHash('sha256').update(raw).digest('hex'); }

async function post(path, raw, now) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`,
      'X-DealerADMIN-Test-Now': now,
    },
    body: raw,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { http_status: response.status, body };
}

async function send(c, sourceMessage, index, now, phone) {
  const eventId = `${c.case_id}-event-${String(index).padStart(2, '0')}`;
  const messageId = `${c.case_id}-message-${String(index).padStart(2, '0')}`;
  const payload = {
    event_id: eventId,
    event_type: 'customer.replied',
    ghl_message_id: messageId,
    ghl_contact_id: c.contact_id,
    ghl_conversation_id: c.conversation_id,
    message_body: sourceMessage.body,
    contact_phone: phone,
    contact_name: c.contact_name,
    channel: c.channel,
    occurred_at: sourceMessage.occurred_at || now,
  };
  const raw = JSON.stringify(payload);
  const response = await post(`/api/webhooks/ghl/customer-replied/${SOURCE}`, raw, now);
  const after = await state(c.conversation_id, c.case_id);
  c.steps.push({ event_id: eventId, conversation_id: c.conversation_id, message_id: messageId, body: sourceMessage.body, payload_hash: hash(raw), response, after });
  return response;
}

async function poll(now) {
  const response = await post('/api/webhooks/ghl/conversations/process-due', '', now);
  evidence.checks.push({ check: `process_due_${now}`, response });
  return response;
}

function newCase(id, contactName, phone) {
  return {
    case_id: `${NS}-${id}`,
    source: SOURCE,
    location_id: LOCATION_ID,
    channel: 'messenger',
    contact_id: `${NS}-${id}-contact`,
    conversation_id: `${NS}-${id}-conversation`,
    contact_name: contactName,
    phone,
    steps: [],
  };
}

async function runCase(c, messages, expected) {
  c.before = await state(c.conversation_id);
  for (const [index, message] of messages.entries()) {
    await send(c, { body: message.body, occurred_at: message.occurred_at }, index + 1, message.occurred_at, message.phone ?? c.phone);
  }
  c.poll_response = await poll('2026-09-13T00:00:00.000Z');
  c.after = await state(c.conversation_id, c.case_id);
  const row = c.after.state[0] ?? {};
  const snapshot = row.qualification_snapshot ?? {};
  const progress = snapshot.qualification_progress ?? {};
  const assignedDealer = c.after.state.map((item) => item.assigned_dealer_id || item.dealer_id).filter(Boolean);
  c.status_before = c.before.state[0]?.status ?? null;
  c.status_after = row.status ?? null;
  c.snapshot_before = c.before.state[0]?.qualification_snapshot ?? null;
  c.snapshot_after = snapshot;
  c.location_snapshot = row.location_snapshot ?? {};
  c.next_attempt_at = row.next_attempt_at ?? null;
  c.dealer_assigned = assignedDealer;
  c.routing_reason = c.after.state.map((item) => item.routing_reason).filter(Boolean);
  c.message_ids = c.after.messages.map((message) => message.id);
  c.event_ids = c.after.events.map((event) => event.event_id);
  c.sql_verification = SQL;
  c.assertions = {
    all_webhooks_accepted: c.steps.every((step) => step.response.http_status === 201 && step.response.body.status === 'processed'),
    all_events_processed: c.after.events.length === messages.length && c.after.events.every((event) => event.status === 'processed'),
    all_messages_stored: c.after.messages.length === messages.length,
    one_conversation: c.after.state.length === 1,
    one_lead_dealer_row: c.after.state.length === 1 && Boolean(row.dealer_id),
    lead_identity: snapshot.real_name === expected.real_name && row.first_name === expected.first_name && row.last_name === expected.last_name,
    phone_normalized: row.canonical_phone === expected.phone && snapshot.phone === expected.phone,
    vehicle_correct: snapshot.vehicle_type === expected.vehicle_type,
    down_correct: snapshot.down_payment === expected.down_payment,
    timeline_correct_and_localized: snapshot.purchase_timeline === expected.purchase_timeline,
    documents_not_invented: snapshot.documents === '' && snapshot.identification === '' && snapshot.bank_account === '',
    dealer_correct: expected.dealer_id ? assignedDealer.includes(expected.dealer_id) : true,
    progress_and_question_present: Boolean(progress.step && progress.predicted_bot_question && progress.language === expected.language),
    queued: row.status === 'queued',
  };
  c.result = Object.values(c.assertions).every(Boolean) ? 'PASS' : 'FAIL';
  evidence.cases.push(c);
  return c;
}

async function main() {
  await pool.query('SELECT 1');
  await reset();
  const input = JSON.parse(await readFile('C:/Users/Dell/.codex/attachments/c8444af2-29ef-49b3-84ed-71dd5ff6af83/pasted-text.txt', 'utf8'));
  evidence.baseline = {
    migration: (await pool.query('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1')).rows[0]?.name ?? null,
    tables: (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")).rows.map((row) => row.table_name),
    dealer: (await pool.query('SELECT id, name, ghl_location_id FROM dealers WHERE ghl_location_id = $1', [LOCATION_ID])).rows,
  };
  const exactMessages = input.messages.map((message, index) => ({
    body: message.body,
    occurred_at: message.occurred_at,
    phone: index < 3 ? '' : '+18642651776',
  }));
  const gabriel = await runCase(newCase('gabriel-reproduced', 'Gabriel Gonzalez', '+18642651776'), exactMessages, {
    real_name: 'Gabriel Gonzalez', first_name: 'Gabriel', last_name: 'Gonzalez', phone: '+18642651776',
    vehicle_type: 'Chevrolet Camaro 2LT', down_payment: 'Cash', purchase_timeline: 'esta semana',
    dealer_id: 'd4444444-4444-4444-4444-444444444444', language: 'es',
  });
  const control = await runCase(newCase('control-corolla', 'Ana Torres', '+12405550199'), [
    { body: 'Busco una Toyota Corolla', occurred_at: '2026-09-12T23:55:00.000Z' },
    { body: 'Tengo 2000 de enganche', occurred_at: '2026-09-12T23:56:00.000Z' },
    { body: 'Esta semana', occurred_at: '2026-09-12T23:57:00.000Z' },
  ], {
    real_name: 'Ana Torres', first_name: 'Ana', last_name: 'Torres', phone: '+12405550199',
    vehicle_type: 'Toyota Corolla', down_payment: '2000', purchase_timeline: 'esta semana', language: 'es',
  });
  evidence.summary = { result: [gabriel, control].every((item) => item.result === 'PASS') ? 'PASS' : 'FAIL', cases: evidence.cases.map((item) => ({ case_id: item.case_id, result: item.result, vehicle: item.snapshot_after?.vehicle_type, timeline: item.snapshot_after?.purchase_timeline })) };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.summary, null, 2));
  await pool.end();
  if (evidence.summary.result !== 'PASS') process.exitCode = 1;
}

main().catch(async (error) => {
  await writeFile(OUT, JSON.stringify({ run_id: NS, result: 'ERROR', error: String(error), secret_printed: false }, null, 2), 'utf8');
  await pool.end();
  console.error(error.message);
  process.exitCode = 1;
});
