import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = process.env.QA_API_URL || 'http://127.0.0.1:3015';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-millersville-easterns-elkton-final-20260912';
const DAY = '2026-09-12T15:00:00.000Z';
const DAY_15S = '2026-09-12T15:00:15.000Z';
const DAY_30S = '2026-09-12T15:00:30.000Z';
const MILLERSVILLE_LOCATION_ID = '113zMWQlhKKBUu5wOYtR';
const EASTERNS_LOCATION_ID = 'xN2LSSl62okzv9GnOJPU';
const MILLERSVILLE = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WHITE_MARSH = 'ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROSEDALE = 'd1111111-1111-1111-1111-111111111111';
const LAUREL = 'd2222222-2222-2222-2222-222222222222';
const STERLING = 'd3333333-3333-3333-3333-333333333333';
const ACTION_EN = 'e9999999-9999-9999-9999-999999999999';
const ACTION_ES = 'e8888888-8888-8888-8888-888888888888';
const pool = new Pool({ connectionString: DB });
const SQL = `SELECT c.id AS conversation_db_id, c.ghl_conversation_id, c.status,
       c.qualification_snapshot, c.location_snapshot, c.next_attempt_at,
       l.id AS lead_id, l.canonical_phone, ld.dealer_id, ld.assigned_dealer_id,
       ld.status AS lead_dealer_status, ld.routing_reason
     FROM conversations c JOIN leads l ON l.id = c.lead_id
     LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
     WHERE c.ghl_conversation_id = $1 ORDER BY ld.created_at NULLS LAST`;
const evidence = { run_id: NS, generated_at: new Date().toISOString(), environment: { api_url: API, database: 'local PostgreSQL in user-provided Docker container', timezone: 'America/Bogota', secret_printed: false }, baseline: {}, cases: [], checks: [] };

async function reset() {
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
  await pool.query(`UPDATE dealer_round_robin_state SET next_index = 0 WHERE allocation_key = 'easterns-millersville'`);
}

async function dbState(conversationId, eventPrefix = null) {
  const state = (await pool.query(SQL, [conversationId])).rows;
  const conversationDbId = state[0]?.conversation_db_id;
  const messages = conversationDbId ? (await pool.query(`SELECT id, ghl_message_id, body, direction, occurred_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at, created_at`, [conversationDbId])).rows : [];
  const events = eventPrefix ? (await pool.query(`SELECT event_id, status, payload_hash, error_code, ghl_location_id FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id`, [`${eventPrefix}-%`])).rows : [];
  return { state, messages, events, sql: SQL };
}

function hash(raw) { return createHash('sha256').update(raw).digest('hex'); }

async function post(path, raw, now) {
  const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`, 'X-DealerADMIN-Test-Now': now }, body: raw });
  const text = await response.text();
  return { http_status: response.status, body: JSON.parse(text) };
}

async function send(c, body, index, now) {
  const eventId = `${c.case_id}-event-${String(index).padStart(2, '0')}`;
  const messageId = `${c.case_id}-message-${String(index).padStart(2, '0')}`;
  const payload = { event_id: eventId, event_type: 'customer.replied', ghl_message_id: messageId, ghl_contact_id: `${c.case_id}-contact`, ghl_conversation_id: c.conversationId, message_body: body, contact_phone: c.phone, contact_name: c.contactName, channel: c.channel, occurred_at: now };
  const raw = JSON.stringify(payload);
  const response = await post(`/api/webhooks/ghl/customer-replied/${c.source}`, raw, now);
  const after = await dbState(c.conversationId, c.case_id);
  c.steps.push({ event_id: eventId, message_id: messageId, payload_hash: hash(raw), body, response, after });
  return response;
}

async function poll(now) {
  const response = await post('/api/webhooks/ghl/conversations/process-due', '', now);
  evidence.checks.push({ check: `process_due_${now}`, response });
  return response;
}

function makeCase(id, source, locationId, phone) {
  return { case_id: `${NS}-${id}`, source, locationId, phone, channel: 'messenger', contactName: 'Ana Rivera', conversationId: `${NS}-${id}-conversation`, steps: [] };
}

function summarize(c, expectedDealerIds = []) {
  const after = c.after?.state ?? [];
  const snapshot = after[0]?.qualification_snapshot ?? {};
  const location = after[0]?.location_snapshot ?? {};
  const assigned = after.map((row) => row.assigned_dealer_id || row.dealer_id).filter(Boolean);
  c.status_before = c.before?.state[0]?.status ?? null;
  c.status_after = after[0]?.status ?? null;
  c.snapshot_after = snapshot;
  c.location_snapshot = location;
  c.dealer_assigned = assigned;
  c.routing_reason = after.map((row) => row.routing_reason).filter(Boolean);
  c.message_ids = c.steps.flatMap((step) => step.after.messages.map((message) => message.id));
  c.expected_dealers = expectedDealerIds;
  c.assertions = {
    no_tacoma_false_positive: !JSON.stringify(location).toLowerCase().includes('tacoma'),
    expected_dealer: expectedDealerIds.includes(assigned.at(-1)),
    queued_after_poll: c.status_after === 'queued',
    one_lead_dealer_row: after.length === 1,
    message_count_expected: c.expected_message_count === undefined || c.poll_after?.messages.length === c.expected_message_count,
    progress_present_after_poll: Boolean(c.poll_after?.state[0]?.qualification_snapshot?.qualification_progress?.predicted_bot_question),
  };
  c.result = Object.values(c.assertions).every(Boolean) ? 'PASS' : 'FAIL';
  c.sql_verification = SQL;
  evidence.cases.push(c);
  return c;
}

async function runMiller(id, firstBody, extraBodies = []) {
  const c = makeCase(id, 'easterns-millersville', MILLERSVILLE_LOCATION_ID, `+1909555${String(evidence.cases.length + 1).padStart(4, '0')}`);
  c.before = await dbState(c.conversationId);
  await send(c, firstBody, 1, DAY);
  if (id === 'miller-troca-elkton') {
    await poll(DAY_15S);
    c.poll_before_late = await dbState(c.conversationId);
    c.conversation_db_id_before_late = c.poll_before_late.state[0]?.conversation_db_id ?? null;
  }
  for (const [index, body] of extraBodies.entries()) await send(c, body, index + 2, id === 'miller-troca-elkton' ? DAY_30S : DAY);
  await poll(id === 'miller-troca-elkton' ? DAY_30S : DAY_15S);
  c.poll_after = await dbState(c.conversationId);
  c.conversation_db_id_after_late = c.poll_after.state[0]?.conversation_db_id ?? null;
  c.expected_message_count = 1 + extraBodies.length;
  c.after = c.poll_after;
  const millerIndex = evidence.cases.filter((x) => x.source === 'easterns-millersville').length;
  const expected = [MILLERSVILLE, WHITE_MARSH, MILLERSVILLE, WHITE_MARSH, MILLERSVILLE, WHITE_MARSH][millerIndex];
  const result = summarize(c, [expected]);
  if (id === 'miller-troca-elkton') {
    result.assertions = {
      ...result.assertions,
      same_conversation_repaired: Boolean(result.conversation_db_id_before_late && result.conversation_db_id_before_late === result.conversation_db_id_after_late),
      initial_poll_left_partial: ['partial', 'waiting_window'].includes(result.poll_before_late.state[0]?.status),
      elkton_md_resolved: result.location_snapshot.city === 'Elkton' && result.location_snapshot.state === 'MD',
      vehicle_normalized_to_truck: result.snapshot_after.vehicle_type === 'truck',
    };
    result.result = Object.values(result.assertions).every(Boolean) ? 'PASS' : 'FAIL';
  }
  return result;
}

async function runEasterns(id, body, expected) {
  const c = makeCase(id, 'easterns', EASTERNS_LOCATION_ID, `+1909556${String(evidence.cases.length + 1).padStart(4, '0')}`);
  c.before = await dbState(c.conversationId);
  await send(c, body, 1, DAY);
  await poll(DAY_15S);
  c.poll_after = await dbState(c.conversationId);
  c.after = c.poll_after;
  return summarize(c, [expected]);
}

async function runGeneric(id, source, locationId, phone, bodies, expected, contactName, checks = {}) {
  const c = makeCase(id, source, locationId, phone);
  c.contactName = contactName;
  c.before = await dbState(c.conversationId);
  for (const [index, body] of bodies.entries()) await send(c, body, index + 1, DAY);
  await poll(DAY_30S);
  c.poll_after = await dbState(c.conversationId);
  c.expected_message_count = bodies.length;
  c.after = c.poll_after;
  const result = summarize(c, [expected]);
  result.assertions = { ...result.assertions, ...Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, Boolean(value(result))])) };
  result.result = Object.values(result.assertions).every(Boolean) ? 'PASS' : 'FAIL';
  return result;
}

async function main() {
  await pool.query('SELECT 1');
  await reset();
  evidence.baseline = {
    locations: (await pool.query(`SELECT name, normalized_name, state_code, easterns_routing_zone FROM locations WHERE normalized_name IN ('elkton', 'tacoma', 'troca') ORDER BY normalized_name, state_code`)).rows,
    last_baltimore: (await pool.query(`SELECT assigned_dealer_id, routing_reason FROM lead_dealers WHERE routing_reason LIKE 'Baltimore Overlap:%' ORDER BY created_at DESC, updated_at DESC LIMIT 1`)).rows[0] ?? null,
    last_southern_md: (await pool.query(`SELECT assigned_dealer_id, routing_reason FROM lead_dealers WHERE routing_reason LIKE 'Southern MD/DC Overlap:%' ORDER BY created_at DESC, updated_at DESC LIMIT 1`)).rows[0] ?? null,
  };
  await runMiller('miller-troca-elkton', 'Troca, que queria una troca', ['Vivo en Elkton MD', 'Me llamo Ana Rivera, tengo 2000 de enganche y compro esta semana']);
  await runMiller('miller-02', 'busco un truck, tengo 1000 de enganche y compro esta semana');
  await runMiller('miller-03', 'busco un SUV, tengo 2000 de enganche y compro esta semana');
  await runMiller('miller-04', 'busco un Mustang, tengo 3000 de enganche y compro esta semana');
  await runMiller('miller-tacoma-model', 'Busco un Toyota Tacoma, tengo 1000 de enganche y compro esta semana');
  await runEasterns('easterns-baltimore-01', 'Busco un truck, tengo 1000 de enganche, compro esta semana. Vivo en Baltimore MD', ROSEDALE);
  await runEasterns('easterns-baltimore-02', 'Busco un truck, tengo 1000 de enganche, compro esta semana. Vivo en Baltimore MD', LAUREL);
  await runEasterns('easterns-new-jersey', 'Busco un Mustang, tengo 1000 de enganche, compro esta semana. Vivo en Newark NJ', ROSEDALE);
  await runEasterns('easterns-silver-spring', 'Busco un SUV, tengo 1000 de enganche, compro esta semana. Vivo en Silver Spring MD', LAUREL);
  await runEasterns('easterns-washington', 'Busco un truck, tengo 1000 de enganche, compro esta semana. Vivo en Washington DC', STERLING);
  await runEasterns('easterns-southern-01', 'Busco un SUV, tengo 1000 de enganche, compro esta semana. Vivo en Waldorf MD', LAUREL);
  await runEasterns('easterns-southern-02', 'Busco un SUV, tengo 1000 de enganche, compro esta semana. Vivo en Waldorf MD', STERLING);
  await runEasterns('easterns-virginia', 'Busco un Mustang, tengo 1000 de enganche, compro esta semana. Vivo en Richmond VA', STERLING);
  await runGeneric('action-hummer-english', 'action-cars', 'ZxadcudjvBz7KFCB1od4', '+19095560001', [
    'What vehicles are eligible?', 'Hummer sut', '252-676-5964 Ceddrick', 'I could pay for it cash', 'Now if possible', 'Yes', 'Ok',
  ], ACTION_EN, 'Ceddrick Moody', {
    hummer_vehicle_captured: (item) => item.snapshot_after.vehicle_type === 'Hummer sut',
    cash_captured: (item) => item.snapshot_after.down_payment === 'Cash',
    immediate_timeline_captured: (item) => item.snapshot_after.purchase_timeline === 'today',
    no_invented_documents: (item) => item.snapshot_after.documents === '',
  });
  await runGeneric('davila-trade-in', 'easterns-millersville', '113zMWQlhKKBUu5wOYtR', '+19095560002', [
    'Podría cambiar un auto que esté en buenas condiciones', 'Una Toyota Trail Hunter', '2027796699 Davila',
    'Quisiera ver si puedo entregar mi vehículo', 'Puedo poner $2000 de enganche', 'Esta semana', 'Ok',
  ], WHITE_MARSH, 'Davila Davila', {
    davila_name_preserved: (item) => item.snapshot_after.real_name === 'Davila Davila',
    vehicle_captured: (item) => item.snapshot_after.vehicle_type === 'Toyota Trail Hunter',
    down_trade_in_captured: (item) => item.snapshot_after.down_payment === '2000 + trade-in',
    no_invented_documents: (item) => item.snapshot_after.documents === '',
  });
  const elkton = evidence.cases.find((item) => item.case_id.endsWith('miller-troca-elkton'));
  elkton.result = Object.values(elkton.assertions).every(Boolean) ? 'PASS' : 'FAIL';
  evidence.summary = { pass: evidence.cases.filter((item) => item.result === 'PASS').length, fail: evidence.cases.filter((item) => item.result === 'FAIL').length, blocked: 0, total_cases: evidence.cases.length, all_pass: evidence.cases.every((item) => item.result === 'PASS') };
  await mkdir(`tmp/${NS}`, { recursive: true });
  await writeFile(`tmp/${NS}/evidence-final.json`, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.summary));
  await pool.end();
}

main().catch(async (error) => { console.error(error.message); await pool.end(); process.exitCode = 1; });
