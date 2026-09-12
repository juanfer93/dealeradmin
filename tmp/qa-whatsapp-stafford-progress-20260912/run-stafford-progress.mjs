import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = process.env.QA_API_URL || 'http://127.0.0.1:3011';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');
const NS = 'qa-whatsapp-stafford-progress-20260912';
const LOCATION_ID = 'LiaoSID3nvAhad49ZpNJ';
const pool = new Pool({ connectionString: DB });
const SQL = `SELECT c.id AS conversation_db_id, c.ghl_conversation_id, c.channel, c.status,
       c.qualification_snapshot, c.location_snapshot, c.ready_at, c.next_attempt_at,
       l.id AS lead_id, l.canonical_phone, ld.dealer_id, ld.assigned_dealer_id,
       ld.status AS lead_dealer_status, ld.routing_reason
     FROM conversations c JOIN leads l ON l.id = c.lead_id
     LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE c.ghl_conversation_id = $1 ORDER BY ld.created_at NULLS LAST`;
const evidence = { run_id: NS, generated_at: new Date().toISOString(), api_url: API, timezone: 'America/Bogota', channel: 'whatsapp', source: 'stafford', cases: [], checks: [] };

async function reset() {
  await pool.query(`DELETE FROM webhook_events WHERE raw_transcript LIKE $1 OR event_id LIKE $1`, [`%${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_conversation_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
}
async function snapshot(conversationId) {
  const result = await pool.query(SQL, [conversationId]);
  const messages = result.rows[0]?.conversation_db_id
    ? (await pool.query(`SELECT id, ghl_message_id, body, direction, occurred_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at, created_at`, [result.rows[0].conversation_db_id])).rows
    : [];
  return { rows: result.rows, messages, sql: SQL };
}
function hashPayload(payload) { return createHash('sha256').update(payload).digest('hex'); }
async function webhook(caseId, index, body, phone, at) {
  const payload = JSON.stringify({ event_id: `${caseId}-event-${index}`, event_type: 'customer.replied', ghl_message_id: `${caseId}-message-${index}`, ghl_contact_id: `${caseId}-contact`, ghl_conversation_id: `${caseId}-conversation`, message_body: body, contact_phone: phone, contact_name: 'WhatsApp Contact', channel: 'whatsapp', occurred_at: at });
  const response = await fetch(`${API}/api/webhooks/ghl/customer-replied/stafford`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(payload).digest('hex')}`, 'X-DealerADMIN-Test-Now': at }, body: payload });
  return { payload: JSON.parse(payload), payload_hash: hashPayload(payload), http_status: response.status, body: await response.json() };
}
async function poll(at) {
  const response = await fetch(`${API}/api/webhooks/ghl/conversations/process-due`, { method: 'POST', headers: { 'X-DealerADMIN-Webhook-Secret': HMAC, 'X-DealerADMIN-Test-Now': at } });
  const body = await response.json();
  evidence.checks.push({ at, http_status: response.status, body });
  return body;
}
async function runCase({ suffix, language, firstBody, secondBody, firstAt, dueAt, expectedStepBefore, expectedQuestionBefore, expectedStepAfter, expectedQuestionAfter }) {
  const caseId = `${NS}-${suffix}`;
  const conversationId = `${caseId}-conversation`;
  const phone = suffix === 'english-down' ? '+12405552011' : '+12405552012';
  const before = await snapshot(conversationId);
  const first = await webhook(caseId, '01', firstBody, phone, firstAt);
  const afterFirst = await snapshot(conversationId);
  const progressFirst = afterFirst.rows[0]?.qualification_snapshot?.qualification_progress;
  const second = await webhook(caseId, '02', secondBody, phone, firstAt);
  const afterSecond = await snapshot(conversationId);
  const progressSecond = afterSecond.rows[0]?.qualification_snapshot?.qualification_progress;
  await poll(dueAt.stabilization);
  const beforeWindow = await snapshot(conversationId);
  await poll(dueAt.release);
  const afterRelease = await snapshot(conversationId);
  const finalRow = afterRelease.rows[0];
  const result = {
    case_id: caseId, language, conversation_id: conversationId, before,
    payloads: [first, second], message_ids: afterSecond.messages.map((m) => m.id),
    event_ids: [first.payload.event_id, second.payload.event_id],
    after_first: afterFirst, after_second: afterSecond, before_window: beforeWindow, after_release: afterRelease,
    progress_after_first: progressFirst, progress_after_second: progressSecond,
    expected_question_before: expectedQuestionBefore, expected_question_after: expectedQuestionAfter,
    result: progressFirst?.step === expectedStepBefore
      && progressFirst?.predicted_bot_question === expectedQuestionBefore
      && progressFirst?.language === language
      && progressSecond?.step === expectedStepAfter
      && progressSecond?.predicted_bot_question === expectedQuestionAfter
      && progressSecond?.language === language
      && finalRow?.status === 'queued'
      && finalRow?.next_attempt_at === null ? 'PASS' : 'FAIL',
  };
  evidence.cases.push(result);
}
async function main() {
  await reset();
  await runCase({ suffix: 'english-down', language: 'en', firstBody: 'My name is Taylor QA. I am looking for a Mustang.', secondBody: 'I can put 2000 down.', firstAt: '2026-09-12T15:00:00.000Z', dueAt: { stabilization: '2026-09-12T15:00:30.000Z', release: '2026-09-12T15:30:00.000Z' }, expectedStepBefore: 'down_payment', expectedQuestionBefore: 'How much do you have for the down payment?', expectedStepAfter: 'purchase_timeline', expectedQuestionAfter: 'When are you planning to buy?' });
  await runCase({ suffix: 'spanish-timeline', language: 'es', firstBody: 'Me llamo Sofia QA. Estoy buscando un truck.', secondBody: 'Lo compro esta semana.', firstAt: '2026-09-13T01:00:00.000Z', dueAt: { stabilization: '2026-09-13T01:00:30.000Z', release: '2026-09-13T04:00:00.000Z' }, expectedStepBefore: 'down_payment', expectedQuestionBefore: '¿Cuánto tienes para el enganche?', expectedStepAfter: 'down_payment', expectedQuestionAfter: '¿Cuánto tienes para el enganche?' });
  evidence.summary = { pass: evidence.cases.filter((c) => c.result === 'PASS').length, fail: evidence.cases.filter((c) => c.result !== 'PASS').length, blocked: 0, total_cases: evidence.cases.length, all_pass: evidence.cases.every((c) => c.result === 'PASS') };
  await mkdir(`tmp/${NS}`, { recursive: true });
  await writeFile(`tmp/${NS}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence.summary));
  await pool.end();
}
main().catch(async (error) => { console.error(error.message); await pool.end(); process.exitCode = 1; });
