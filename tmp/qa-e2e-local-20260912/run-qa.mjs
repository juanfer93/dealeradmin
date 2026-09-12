import { createHash, createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = process.env.QA_API_URL || 'http://127.0.0.1:3010';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const DAY = '2026-09-12T15:00:00.000Z'; // 10:00 America/Bogota
const DAY_15S = '2026-09-12T15:00:15.000Z';
const DAY_30S = '2026-09-12T15:00:30.000Z';
const DAY_30M = '2026-09-12T15:30:00.000Z';
const NIGHT = '2026-09-13T01:00:00.000Z'; // 20:00 America/Bogota
const NIGHT_3H = '2026-09-13T04:00:00.000Z';
const NS = 'qa-e2e-20260912';

const sourceConfig = {
  stafford: ['LiaoSID3nvAhad49ZpNJ', 'whatsapp'], fredericksburg: ['MyxWNKacThim798E8KC6', 'messenger'],
  'fredericksburg-2': ['bAuMEQeH48xAtu9tAMFf', 'messenger'], easterns: ['xN2LSSl62okzv9GnOJPU', 'messenger'],
  arlington: ['9v8zH9Y5eLiiJwZTZDci', 'messenger'], 'koons-fred': ['xuHo0opTO2g5edIuPJRl', 'messenger'],
  'koons-fred-eng': ['ozAIEblxTjrh0PfoaHge', 'messenger'], 'koons-culpeper': ['bTNJHpNZ8FaS1PUHkuUq', 'messenger'],
  'action-cars': ['ZxadcudjvBz7KFCB1od4', 'messenger'], 'easterns-millersville': ['113zMWQlhKKBUu5wOYtR', 'messenger'],
  'easterns-frederick': ['MRHcOwdTqaN5cug3eSWW', 'messenger'],
};

const pool = new Pool({ connectionString: DB });
const evidence = { run_id: NS, generated_at: new Date().toISOString(), environment: { api_url: API, database: 'local PostgreSQL in user-provided Docker container', timezone: 'America/Bogota', secret_printed: false }, cases: [], checks: [] };
const SQL = `SELECT c.id AS conversation_db_id, c.ghl_conversation_id, c.status, c.qualification_snapshot, c.location_snapshot, c.next_attempt_at, l.id AS lead_id, l.canonical_phone, ld.dealer_id, ld.assigned_dealer_id, ld.status AS lead_dealer_status, ld.routing_reason FROM conversations c JOIN leads l ON l.id=c.lead_id LEFT JOIN lead_dealers ld ON ld.lead_id=l.id WHERE c.ghl_conversation_id=$1 ORDER BY ld.created_at NULLS LAST`;

async function dbState(conversationId, eventPrefix = null) {
  const state = (await pool.query(SQL, [conversationId])).rows;
  const messages = (await pool.query('SELECT id, ghl_message_id, dedupe_key, direction, body, occurred_at FROM conversation_messages WHERE conversation_id=(SELECT id FROM conversations WHERE ghl_conversation_id=$1) ORDER BY occurred_at, created_at', [conversationId])).rows;
  const events = eventPrefix ? (await pool.query('SELECT event_id, status, payload_hash, error_code, ghl_location_id FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id', [`${eventPrefix}-%`])).rows : [];
  return { state, messages, events, sql: SQL };
}

function hash(body) { return createHash('sha256').update(body).digest('hex'); }
async function postRaw(path, raw, headers = {}, signatureOverride = null) {
  const signature = signatureOverride || `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`;
  const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-GHL-Signature': signature, ...headers }, body: raw });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { http_status: response.status, body };
}
async function send(c, message, index, now, phone = c.phone, contactName = c.contactName, channel = c.channel) {
  const eventId = `${c.id}-evt-${String(index).padStart(2, '0')}`;
  const messageId = `${c.id}-msg-${String(index).padStart(2, '0')}`;
  const payload = { event_id: eventId, event_type: 'customer.replied', ghl_message_id: messageId, ghl_contact_id: c.contactId, ghl_conversation_id: c.conversationId, message_body: message, contact_phone: phone, contact_name: contactName, channel, occurred_at: now };
  const raw = JSON.stringify(payload);
  const result = await postRaw(`/api/webhooks/ghl/customer-replied/${c.source}`, raw, { 'X-DealerADMIN-Test-Now': now });
  const state = await dbState(c.conversationId, c.id);
  c.steps.push({ event_id: eventId, conversation_id: c.conversationId, message_ids: state.messages.map(x => x.id), payload_hash: hash(raw), response: result, after: state.state, snapshot_after: state.state[0]?.qualification_snapshot ?? null, location_snapshot: state.state[0]?.location_snapshot ?? null });
  return result;
}
async function due(now) {
  const raw = '';
  const result = await postRaw('/api/webhooks/ghl/conversations/process-due', raw, { 'X-DealerADMIN-Test-Now': now });
  evidence.checks.push({ check: `process_due_${now}`, response: result });
  return result;
}
function newCase(id, source, options = {}) {
  const [locationId, defaultChannel] = sourceConfig[source];
  return { id: `${NS}-${id}`, source, locationId, channel: options.channel || defaultChannel, contactId: `${NS}-${id}-contact`, conversationId: `${NS}-${id}-conversation`, contactName: options.contactName ?? `QA ${id}`, phone: options.phone ?? '+12405550100', steps: [], before: null, after: null, expected: options.expected ?? {} };
}
async function runCase(c, bodies, now = DAY, releaseNow = DAY_15S) {
  c.before = await dbState(c.conversationId, c.id);
  for (let i = 0; i < bodies.length; i += 1) await send(c, bodies[i], i + 1, now);
  if (releaseNow) await due(releaseNow);
  c.after = await dbState(c.conversationId, c.id);
  c.status_before = c.before.state[0]?.status ?? null;
  c.status_after = c.after.state[0]?.status ?? null;
  c.snapshot_before = c.before.state[0]?.qualification_snapshot ?? null;
  c.snapshot_after = c.after.state[0]?.qualification_snapshot ?? null;
  c.location_snapshot = c.after.state[0]?.location_snapshot ?? null;
  c.next_attempt_at = c.after.state[0]?.next_attempt_at ?? null;
  c.dealer_assigned = c.after.state.map(x => x.assigned_dealer_id || x.dealer_id).filter(Boolean);
  c.routing_reason = c.after.state.map(x => x.routing_reason).filter(Boolean);
  c.sql_verification = SQL;
  evidence.cases.push(c);
  return c;
}
function assertCase(c, pass, note) { c.result = pass ? 'PASS' : 'FAIL'; c.assertion = note; return pass; }

async function seedFixtures() {
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
  await pool.query(`UPDATE dealer_round_robin_state SET next_index=0 WHERE allocation_key='easterns-millersville'`);
  const fixed = new Date(DAY);
  const old = new Date(fixed.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(fixed.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(`INSERT INTO leads (id, canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source, created_at, updated_at) VALUES ($1,$2,'Stale','Exactly',$3,$4,'QA',$5,$5), ($6,$7,'Recent','Allowed',$8,$4,'QA',$9,$9)`, [`00000000-0000-0000-0000-000000000001`, '+12405550211', `${NS}-stale-seed`, sourceConfig.fredericksburg[0], old, `00000000-0000-0000-0000-000000000002`, '+12405550212', `${NS}-recent-seed`, recent]);
  await pool.query(`INSERT INTO lead_dealers (lead_id,dealer_id,vehicle_type,down_payment,purchase_timeline,routing_status,status,sent_at,created_at,updated_at) SELECT $1,id,'Mustang','2000','this week','resolved','sent',$2,$2,$2 FROM dealers WHERE code='DLR-FRED-001'`, [`00000000-0000-0000-0000-000000000001`, old]);
  await pool.query(`INSERT INTO lead_dealers (lead_id,dealer_id,vehicle_type,down_payment,purchase_timeline,routing_status,status,sent_at,created_at,updated_at) SELECT $1,id,'Mustang','2000','this week','resolved','sent',$2,$2,$2 FROM dealers WHERE code='DLR-FRED-001'`, [`00000000-0000-0000-0000-000000000002`, recent]);
  await pool.query(`INSERT INTO leads (id, canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source) SELECT '00000000-0000-0000-0000-000000000003', '+12405550113','Sent','Lead',$1,$2,'QA'`, [ `${NS}-sent-seed`, sourceConfig.fredericksburg[0] ]);
  await pool.query(`INSERT INTO conversations (id,lead_id,ghl_location_id,ghl_contact_id,ghl_conversation_id,channel,status,qualification_snapshot,location_snapshot,ready_at) VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003',$1,$2,$3,'messenger','sent',$4::jsonb,'{}'::jsonb,$5)`, [sourceConfig.fredericksburg[0], `${NS}-sent-seed-contact`, `${NS}-sent-reprocess-conversation`, JSON.stringify({ real_name: 'Sent Lead', phone: '+12405550113', vehicle_type: 'Mustang', down_payment: '2000', purchase_timeline: 'this week', documents: '', identification: '', bank_account: '', qualification_memory: '', qualification_complete: true, missing_qualification: [], message_count: 0, assigned_dealer_id: 'd1111111-1111-1111-1111-111111111111' }), DAY]);
  await pool.query(`INSERT INTO lead_dealers (lead_id,dealer_id,vehicle_type,down_payment,purchase_timeline,routing_status,status,sent_at) SELECT '00000000-0000-0000-0000-000000000003',id,'Mustang','2000','this week','resolved','sent',$1 FROM dealers WHERE code='DLR-FRED-001'`, [DAY]);
}

async function main() {
  await pool.query('SELECT 1');
  await seedFixtures();
  evidence.baseline = { migration: (await pool.query('SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1')).rows[0]?.name, tables: (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")).rows.map(x => x.table_name), dealers: (await pool.query('SELECT code,name,ghl_location_id FROM dealers WHERE active=true ORDER BY code')).rows, source_aliases: (await pool.query('SELECT ghl_location_id,dealer_id FROM dealer_location_aliases ORDER BY ghl_location_id')).rows };

  const all = [
    ['stafford', ['¿Qué requisitos necesito?', 'Me llamo Sofia QA', 'busco un Mustang', '1000', 'este mes', 'tengo identificacion, tengo cuenta bancaria y prueba de ingresos'], { contactName: 'Lead', phone: '+12405550120' }],
    ['fredericksburg', ['busco un Mustang, tengo 2000 de enganche, compro esta semana'], { contactName: 'Ana Fred', phone: '+12405550121' }],
    ['fredericksburg-2', ['tengo un truck, 3000 de enganche, compro este mes'], { contactName: 'Bruno F2', phone: '+12405550122' }],
    ['arlington', ['busco un Civic, tengo 1000 de enganche, compro esta semana'], { contactName: 'Arlington QA', phone: '+12405550223' }],
    ['koons-fred', ['busco un SUV, tengo 2000 de enganche, compro esta semana'], { contactName: 'Koons ES', phone: '+12405550124' }],
    ['koons-fred-eng', ['looking for a truck, I have 3000 down, buying this month'], { contactName: 'Koons EN', phone: '+12405550125' }],
    ['koons-culpeper', ['busco un RAV4, tengo 1000 de enganche, compro esta semana'], { contactName: 'Culpeper QA', phone: '+12405550126' }],
    ['easterns-frederick', ['busco un Sedan, tengo 2000 de enganche, compro esta semana'], { contactName: 'Eastern Frederick', phone: '+12405550127' }],
  ];
  for (const [source, bodies, opts] of all) { const c = await runCase(newCase(`source-${source.replaceAll('-', '_')}`, source, opts), bodies); assertCase(c, c.status_after === 'queued', `source ${source} persisted and queued`); }

  const actionEs = await runCase(newCase('action-es', 'action-cars', { contactName: 'Action Español', phone: '+12405550130' }), ['busco un Mustang, tengo 1000 de enganche, compro esta semana']);
  const actionEn = await runCase(newCase('action-en', 'action-cars', { contactName: 'Action English', phone: '+12405550131' }), ['looking for a truck, I have 2000 down, buying this month']);
  assertCase(actionEs, actionEs.status_after === 'queued' && actionEs.snapshot_after.language === 'es', 'Action Cars Spanish queue');
  assertCase(actionEn, actionEn.status_after === 'queued' && actionEn.snapshot_after.language === 'en', 'Action Cars English queue');

  const millerCodes = [];
  for (let i = 1; i <= 4; i += 1) { const c = await runCase(newCase(`millersville-${i}`, 'easterns-millersville', { contactName: `Miller ${i}`, phone: `+124055501${40 + i}` }), ['busco un truck, tengo 1000 de enganche, compro esta semana']); millerCodes.push(c.dealer_assigned[0]); assertCase(c, c.status_after === 'queued', `Millersville case ${i} queued`); }
  evidence.checks.push({ check: 'millersville_sequence', expected: ['eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'], actual: millerCodes });

  for (const [label, body, expected] of [
    ['rosedale', 'busco un Mustang, tengo 1000 de enganche, compro esta semana. Estoy en Rosedale', 'd1111111-1111-1111-1111-111111111111'],
    ['laurel-ambiguous', 'busco un Mustang, tengo 1000 de enganche, compro esta semana. Estoy en Laurel', 'd2222222-2222-2222-2222-222222222222'],
    ['laurel-explicit-va', 'busco un Mustang, tengo 1000 de enganche, compro esta semana. Estoy en Laurel VA', 'd3333333-3333-3333-3333-333333333333'],
    ['sterling', 'busco un Mustang, tengo 1000 de enganche, compro esta semana. Estoy en Sterling', 'd3333333-3333-3333-3333-333333333333'],
    ['newark-collision', 'busco un Mustang, tengo 1000 de enganche, compro esta semana. Estoy en Newark', 'd1111111-1111-1111-1111-111111111111'],
  ]) { const c = await runCase(newCase(`easterns-${label}`, 'easterns', { contactName: `Easterns ${label}`, phone: `+124055501${60 + evidence.cases.length}` }), [body]); assertCase(c, c.status_after === 'queued' && c.dealer_assigned.includes(expected), `Easterns ${label} expected dealer ${expected}`); }

  const late = newCase('late-repair', 'fredericksburg', { contactName: 'Late Repair', phone: '+12405550180' });
  late.before = await dbState(late.conversationId); await send(late, 'busco un Mustang', 1, DAY); const firstDbId = late.steps[0].after[0]?.conversation_db_id; await send(late, '2000\nesta semana', 2, DAY); await due(DAY_30S); late.after = await dbState(late.conversationId); late.status_after = late.after.state[0]?.status; late.same_conversation_repaired = firstDbId === late.after.state[0]?.conversation_db_id; late.snapshot_after = late.after.state[0]?.qualification_snapshot; late.sql_verification = SQL; assertCase(late, late.status_after === 'queued' && late.same_conversation_repaired, 'late inbound message repaired same conversation after simulated 30s poll'); evidence.cases.push(late);

  const manual = await runCase(newCase('manual-waiting-null', 'fredericksburg', { contactName: 'Manual Waiting', phone: '+12405550181' }), ['hola'], null); await pool.query(`UPDATE conversations SET status='waiting_window', next_attempt_at=NULL WHERE ghl_conversation_id=$1`, [manual.conversationId]); await due(DAY); manual.after = await dbState(manual.conversationId); manual.next_attempt_at = manual.after.state[0]?.next_attempt_at; assertCase(manual, Boolean(manual.next_attempt_at), 'manual waiting_window null received calculated next_attempt_at');

  const day = await runCase(newCase('window-day', 'fredericksburg', { contactName: 'Window Day', phone: '+12405550182' }), ['busco un Mustang, tengo 1000 de enganche'], DAY, null); await due(DAY_30M); day.after = await dbState(day.conversationId); day.status_after = day.after.state[0]?.status; assertCase(day, day.status_after === 'queued', '10:00 Bogota plus simulated 30 minutes queued');
  const night = await runCase(newCase('window-night', 'fredericksburg', { contactName: 'Window Night', phone: '+12405550183' }), ['busco un Mustang, tengo 1000 de enganche'], NIGHT, null); await due(NIGHT_3H); night.after = await dbState(night.conversationId); night.status_after = night.after.state[0]?.status; assertCase(night, night.status_after === 'queued', '20:00 Bogota plus simulated 3 hours queued');

  const contam = await runCase(newCase('contamination-question', 'stafford', { contactName: 'Lead', phone: '+12405550184' }), ['¿Qué requisitos necesito?', 'financiar un auto'], DAY, null); assertCase(contam, !contam.snapshot_after.real_name && !contam.snapshot_after.vehicle_type, 'bot question and financing intent stay out of name/vehicle');
  const isolated = await runCase(newCase('isolated-mustang', 'fredericksburg', { contactName: 'Isolated', phone: '+12405550185' }), ['Mustang'], DAY, null); assertCase(isolated, !isolated.snapshot_after.vehicle_type, 'isolated Mustang is not vehicle evidence');
  const years = await runCase(newCase('years-and-down', 'fredericksburg', { contactName: 'Years QA', phone: '+12405550186' }), ['2025', '2018', '2000'], DAY, null); assertCase(years, years.snapshot_after.down_payment === '2000', 'years not down and 2000 is down');

  const phoneFix = newCase('phone-correction', 'fredericksburg', { contactName: 'Phone Fix', phone: 'not-a-phone' }); phoneFix.before = await dbState(phoneFix.conversationId); await send(phoneFix, 'hola', 1, DAY); await send(phoneFix, '+1 (804) 309-2500', 2, DAY); await send(phoneFix, 'busco un Mustang, 1000, esta semana', 3, DAY); await due(DAY_15S); phoneFix.after = await dbState(phoneFix.conversationId); phoneFix.status_after = phoneFix.after.state[0]?.status; phoneFix.snapshot_after = phoneFix.after.state[0]?.qualification_snapshot; assertCase(phoneFix, phoneFix.snapshot_after.phone === '+18043092500', 'invalid phone corrected by latest valid inbound number'); evidence.cases.push(phoneFix);

  const duplicateFirst = await runCase(newCase('duplicate-original', 'fredericksburg', { contactName: 'Duplicate Buyer', phone: '+12405550187' }), ['busco un Mustang, tengo 2000 de enganche, compro esta semana']);
  const duplicateSecond = await runCase(newCase('duplicate-retry', 'fredericksburg', { contactName: 'Duplicate Buyer', phone: '+12405550187' }), ['busco un Mustang, tengo 2000 de enganche, compro esta semana']);
  assertCase(duplicateFirst, duplicateFirst.status_after === 'queued', 'duplicate source queued first'); assertCase(duplicateSecond, duplicateSecond.status_after === 'duplicate_ignored', 'queued same name and phone ignored');

  const idempotent = newCase('idempotent-message-retry', 'fredericksburg', { contactName: 'Idempotent Retry', phone: '+12405550190' });
  const firstDelivery = await send(idempotent, 'busco un Mustang, tengo 1000 de enganche, compro esta semana', 1, DAY);
  const beforeRetry = await dbState(idempotent.conversationId);
  const retryDelivery = await send(idempotent, 'busco un Mustang, tengo 1000 de enganche, compro esta semana', 1, DAY);
  const afterRetry = await dbState(idempotent.conversationId);
  idempotent.status_after = afterRetry.state[0]?.status ?? null;
  idempotent.message_count_before_retry = beforeRetry.messages.length;
  idempotent.message_count_after_retry = afterRetry.messages.length;
  idempotent.sql_verification = SQL;
  assertCase(idempotent, firstDelivery.body.status === 'processed' && retryDelivery.body.status === 'duplicate_ignored' && beforeRetry.messages.length === afterRetry.messages.length, 'same event and message retry is idempotent');
  evidence.cases.push(idempotent);

  const sent = newCase('sent-reprocess', 'fredericksburg', { contactName: 'Sent Lead', phone: '+12405550113' }); sent.before = await dbState(sent.conversationId); const sentResult = await send({ ...sent, conversationId: `${NS}-sent-reprocess-conversation`, contactId: `${NS}-sent-seed-contact` }, 'late message', 1, DAY); sent.after = await dbState(`${NS}-sent-reprocess-conversation`); sent.status_after = sent.after.state[0]?.status; assertCase(sent, sent.status_after === 'sent', `sent reprocess response ${JSON.stringify(sentResult.body)}`); evidence.cases.push(sent);

  const concurrent = newCase('concurrent-poll', 'fredericksburg', { contactName: 'Concurrent', phone: '+12405550188' }); await send(concurrent, 'busco un Mustang, tengo 1000 de enganche, compro esta semana', 1, DAY); const concurrentResults = await Promise.all([due(DAY_15S), due(DAY_15S)]); concurrent.after = await dbState(concurrent.conversationId); concurrent.status_after = concurrent.after.state[0]?.status; concurrent.lead_dealer_count = concurrent.after.state.filter(x => x.dealer_id).length; assertCase(concurrent, concurrent.status_after === 'queued' && concurrent.lead_dealer_count === 1, 'concurrent poll produces one queued relationship'); evidence.cases.push(concurrent); evidence.checks.push({ check: 'concurrent_poll', responses: concurrentResults });

  const stale = newCase('stale-phone-exact-3-days', 'fredericksburg', { contactName: 'Stale Exactly', phone: '+12405550211' }); await send(stale, 'busco un Mustang, tengo 2000 de enganche, compro esta semana', 1, DAY); stale.after = await dbState(stale.conversationId); stale.status_after = stale.after.state[0]?.status; stale.snapshot_after = stale.after.state[0]?.qualification_snapshot; assertCase(stale, stale.status_after === 'stale_phone_ignored', 'phone sent exactly 3 days earlier is not accepted as new lead'); evidence.cases.push(stale);
  const recent = newCase('recent-phone-allowed', 'fredericksburg', { contactName: 'Recent Allowed', phone: '+12405550212' }); await send(recent, 'busco un Mustang, tengo 2000 de enganche, compro esta semana', 1, DAY); recent.after = await dbState(recent.conversationId); recent.status_after = recent.after.state[0]?.status; assertCase(recent, recent.status_after === 'waiting_window', 'phone sent less than 3 days earlier is not blocked by stale rule'); evidence.cases.push(recent);

  const badSig = await postRaw('/api/webhooks/ghl/customer-replied/fredericksburg', JSON.stringify({ event_id: `${NS}-bad-signature-evt`, ghl_contact_id: `${NS}-bad-contact`, ghl_conversation_id: `${NS}-bad-conversation`, ghl_message_id: `${NS}-bad-message`, message_body: 'x', contact_phone: '+12405550189', contact_name: 'Bad Signature', channel: 'messenger' }), {}, 'sha256=invalid'); evidence.checks.push({ check: 'invalid_signature', response: badSig });
  const frontend = await fetch('http://127.0.0.1:3000/login').then(r => ({ status: r.status, ok: r.ok })).catch(error => ({ error: error.message })); evidence.frontend = { login_page: frontend };

  const pass = evidence.cases.filter(x => x.result === 'PASS').length; const fail = evidence.cases.filter(x => x.result === 'FAIL').length; evidence.summary = { pass, fail, blocked: 0, all_pass: fail === 0, total_cases: evidence.cases.length };
  await writeFile('tmp/qa-e2e-local-20260912/evidence.json', JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.summary));
  if (fail) process.exitCode = 2;
}

main().catch(async error => { await writeFile('tmp/qa-e2e-local-20260912/fatal.json', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)); console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => pool.end());
