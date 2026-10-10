import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = process.env.QA_API_URL || 'http://127.0.0.1:3015';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-random-all-dealers-20260912';
const NOW = '2026-09-12T16:00:00.000Z';
const OUT = new URL('./evidence.json', import.meta.url);
const sources = {
  stafford: ['LiaoSID3nvAhad49ZpNJ', 'whatsapp', 'Me llamo Rafael Soto. Busco una Toyota Tacoma, tengo 2000 de enganche y compro esta semana.'],
  fredericksburg: ['MyxWNKacThim798E8KC6', 'messenger', 'Busco un Honda Civic, tengo 1000 de enganche y compro esta semana.'],
  'fredericksburg-2': ['bAuMEQeH48xAtu9tAMFf', 'messenger', 'I want a Ford Explorer, I have 3000 down, buying this month.'],
  easterns: ['xN2LSSl62okzv9GnOJPU', 'messenger', 'I am looking for a Chevy Malibu, I have 1000 down, buying this week. I live in Silver Spring MD.'],
  arlington: ['9v8zH9Y5eLiiJwZTZDci', 'messenger', 'Estoy buscando un Chevrolet Camaro con paquete 2LT, tengo 2000 de enganche y compro esta semana.'],
  'koons-fred': ['xuHo0opTO2g5edIuPJRl', 'messenger', 'Tengo una Dodge Charger, 1000 de enganche, compro este mes.'],
  'koons-fred-eng': ['ozAIEblxTjrh0PfoaHge', 'messenger', 'Looking for a Toyota Corolla, I have 2000 down, buying this week.'],
  'koons-culpeper': ['bTNJHpNZ8FaS1PUHkuUq', 'messenger', 'Busco una Honda CR-V, tengo 3000 de enganche y compro este mes.'],
  'action-cars': ['ZxadcudjvBz7KFCB1od4', 'messenger', 'Quiero una Jeep Wrangler, tengo 1000 de enganche y compro esta semana.'],
  'easterns-millersville': ['113zMWQlhKKBUu5wOYtR', 'messenger', 'Quiero una Toyota Tacoma, tengo 2000 de enganche y compro esta semana. Vivo en Elkton MD.'],
  'easterns-frederick': ['MRHcOwdTqaN5cug3eSWW', 'messenger', 'I want a Ram 1500, I have 3000 down, buying this month.'],
};
const SQL = `SELECT c.id AS conversation_db_id, c.ghl_conversation_id, c.channel, c.status,
       c.qualification_snapshot, c.location_snapshot, c.next_attempt_at,
       l.id AS lead_id, l.canonical_phone, l.first_name, l.last_name,
       ld.dealer_id, ld.assigned_dealer_id, ld.status AS lead_dealer_status, ld.routing_reason,
       d.name AS dealer_name
     FROM conversations c JOIN leads l ON l.id = c.lead_id
     LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
     LEFT JOIN dealers d ON d.id = ld.dealer_id
     WHERE c.ghl_conversation_id = $1 ORDER BY ld.created_at NULLS LAST`;
const pool = new Pool({ connectionString: DB });
const evidence = { run_id: NS, generated_at: new Date().toISOString(), environment: { api_url: API, database: 'local PostgreSQL in user-provided Docker container', timezone: 'America/Bogota', secret_printed: false }, cases: [], sql_verification: SQL };

async function reset() {
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
}
async function state(conversationId, prefix) {
  const rows = (await pool.query(SQL, [conversationId])).rows;
  const dbId = rows[0]?.conversation_db_id;
  const messages = dbId ? (await pool.query('SELECT id, ghl_message_id, direction, body, occurred_at FROM conversation_messages WHERE conversation_id=$1 ORDER BY occurred_at, created_at', [dbId])).rows : [];
  const events = (await pool.query('SELECT event_id, status, payload_hash, error_code, ghl_location_id FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id', [`${prefix}-%`])).rows;
  return { state: rows, messages, events };
}
function hash(raw) { return createHash('sha256').update(raw).digest('hex'); }
async function post(path, raw, now) {
  const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`, 'X-DealerADMIN-Test-Now': now }, body: raw });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { http_status: response.status, body };
}
async function main() {
  await pool.query('SELECT 1');
  await reset();
  evidence.baseline = { migration: (await pool.query('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1')).rows[0]?.name ?? null, active_dealers: (await pool.query('SELECT code,name,ghl_location_id FROM dealers WHERE active=true ORDER BY code')).rows };
  let index = 0;
  for (const [source, [locationId, channel, body]] of Object.entries(sources)) {
    index += 1;
    const caseId = `${NS}-${source}`;
    const conversationId = `${caseId}-conversation`;
    const contactId = `${caseId}-contact`;
    const phone = `+1240555${String(700 + index).padStart(4, '0')}`;
    const contactName = `Random ${source.replaceAll('-', ' ')}`;
    const payload = { event_id: `${caseId}-event-01`, event_type: 'customer.replied', ghl_message_id: `${caseId}-message-01`, ghl_contact_id: contactId, ghl_conversation_id: conversationId, message_body: body, contact_phone: phone, contact_name: contactName, channel, occurred_at: NOW };
    const raw = JSON.stringify(payload);
    const before = await state(conversationId, caseId);
    const webhook = await post(`/api/webhooks/ghl/customer-replied/${source}`, raw, NOW);
    const afterWebhook = await state(conversationId, caseId);
    const poll = await post('/api/webhooks/ghl/conversations/process-due', '', '2026-09-12T16:00:30.000Z');
    const after = await state(conversationId, caseId);
    const row = after.state[0] ?? {};
    const snapshot = row.qualification_snapshot ?? {};
    const progress = snapshot.qualification_progress ?? {};
    const result = {
      case_id: caseId, source, channel, location_id: locationId, event_id: payload.event_id, conversation_id: conversationId,
      payload_hash: hash(raw), message_ids: after.messages.map((message) => message.id), status_before: before.state[0]?.status ?? null, status_after: row.status ?? null,
      snapshot_before: before.state[0]?.qualification_snapshot ?? null, snapshot_after: snapshot, location_snapshot: row.location_snapshot ?? null,
      dealer_assigned: after.state.map((item) => item.dealer_name || item.assigned_dealer_id).filter(Boolean), next_attempt_at: row.next_attempt_at ?? null,
      routing_reason: after.state.map((item) => item.routing_reason).filter(Boolean), webhook, poll, after_webhook: afterWebhook,
      assertions: {
        webhook_processed: webhook.http_status === 201 && webhook.body.status === 'processed', event_processed: after.events.length === 1 && after.events[0].status === 'processed',
        message_persisted: after.messages.length === 1, one_conversation_and_assignment: after.state.length === 1 && Boolean(row.dealer_id), queued: row.status === 'queued',
        vehicle_is_clean: Boolean(snapshot.vehicle_type) && !/seg[uú]n su|informaci[oó]n|question|pregunta/i.test(snapshot.vehicle_type), progress_present: Boolean(progress.step && progress.predicted_bot_question),
      },
      sql_verification: SQL,
    };
    result.result = Object.values(result.assertions).every(Boolean) ? 'PASS' : 'FAIL';
    evidence.cases.push(result);
  }
  evidence.summary = { result: evidence.cases.every((item) => item.result === 'PASS') ? 'PASS' : 'FAIL', total: evidence.cases.length, pass: evidence.cases.filter((item) => item.result === 'PASS').length, fail: evidence.cases.filter((item) => item.result !== 'PASS').length };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.summary, null, 2));
  console.log(JSON.stringify(evidence.cases.map((item) => ({ source: item.source, result: item.result, dealer: item.dealer_assigned, vehicle: item.snapshot_after?.vehicle_type, timeline: item.snapshot_after?.purchase_timeline })), null, 2));
  await pool.end();
  if (evidence.summary.result !== 'PASS') process.exitCode = 1;
}
main().catch(async (error) => { await writeFile(OUT, JSON.stringify({ run_id: NS, result: 'ERROR', error: String(error), secret_printed: false }, null, 2), 'utf8'); await pool.end(); console.error(error.message); process.exitCode = 1; });
