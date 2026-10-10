import { createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');
const API = 'http://127.0.0.1:3021';
const DB = 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = 'qa-recent-phone-20260913';
const oldContact = `${NS}-old-contact`;
const oldConversation = `${NS}-old-conversation`;
const recentContact = `${NS}-recent-contact`;
const recentConversation = `${NS}-recent-conversation`;
const phone = '(240) 681-5028';
const canonicalPhone = '+12406815028';
const recentPhone = '(301) 555-0123';
const recentCanonicalPhone = '+13015550123';
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
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id IN ($1, $2))`, [oldContact, recentContact]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id IN ($1, $2)`, [oldContact, recentContact]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id IN ($1, $2)`, [oldContact, recentContact]);
}

async function seedOldRegisteredContact() {
  await pool.query(
    `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source, created_at, updated_at)
     VALUES ($1, 'Old', 'GHL Contact', $2, 'LiaoSID3nvAhad49ZpNJ', 'GHL Customer Replied', '2026-06-15T18:00:00.000Z', '2026-06-15T18:00:00.000Z')`,
    [canonicalPhone, oldContact],
  );
}

async function snapshot(conversationId) {
  const rows = (await pool.query(SQL, [conversationId])).rows;
  const dbId = rows[0]?.conversation_db_id;
  const messages = dbId ? (await pool.query(`SELECT id, ghl_message_id, direction, body, occurred_at FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at, created_at`, [dbId])).rows : [];
  const events = (await pool.query(`SELECT event_id, status, payload_hash, ghl_location_id FROM webhook_events WHERE event_id LIKE $1 ORDER BY event_id`, [`${NS}%`])).rows;
  return { rows, messages, events, sql: SQL };
}

async function webhook(caseKey, index, body, occurredAt, conversationId, contactId, contactPhone) {
  const payload = {
    event_id: `${NS}-${caseKey}-event-${String(index).padStart(2, '0')}`,
    event_type: 'customer.replied',
    ghl_message_id: `${NS}-${caseKey}-message-${String(index).padStart(2, '0')}`,
    ghl_contact_id: contactId,
    ghl_conversation_id: conversationId,
    message_body: body,
    contact_phone: contactPhone,
    contact_name: 'Old GHL Contact',
    channel: 'whatsapp',
    occurred_at: occurredAt,
  };
  const raw = JSON.stringify(payload);
  const response = await fetch(`${API}/api/webhooks/ghl/customer-replied/stafford`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`,
      'X-DealerADMIN-Test-Now': occurredAt,
    },
    body: raw,
  });
  return {
    payload,
    payload_hash: createHash('sha256').update(raw).digest('hex'),
    http_status: response.status,
    body: await response.json(),
  };
}

async function poll(at) {
  const response = await fetch(`${API}/api/webhooks/ghl/conversations/process-due`, {
    method: 'POST',
    headers: { 'X-DealerADMIN-Webhook-Secret': HMAC, 'X-DealerADMIN-Test-Now': at },
  });
  return { at, http_status: response.status, body: await response.json() };
}

await reset();
await seedOldRegisteredContact();
const before = { old: await snapshot(oldConversation), recent: await snapshot(recentConversation) };
const steps = [];
// The GHL contact already has a phone, but this new conversation has no
// phone history. Vehicle and down are present, so the only missing evidence
// is the customer's explicit phone message.
steps.push({ case: 'old', body: 'I am looking for a sedan and can put 2000 down', at: '2026-09-14T18:29:00.000Z', response: await webhook('old', 1, 'I am looking for a sedan and can put 2000 down', '2026-09-14T18:29:00.000Z', oldConversation, oldContact, phone) });
steps.push({ case: 'recent', body: `My number is ${recentPhone}`, at: '2026-09-14T18:26:00.000Z', response: await webhook('recent', 1, `My number is ${recentPhone}`, '2026-09-14T18:26:00.000Z', recentConversation, recentContact, recentPhone) });
steps.push({ case: 'recent', body: 'I am looking for a sedan and can put 2000 down', at: '2026-09-14T18:29:00.000Z', response: await webhook('recent', 2, 'I am looking for a sedan and can put 2000 down', '2026-09-14T18:29:00.000Z', recentConversation, recentContact, recentPhone) });
const captured = { old: await snapshot(oldConversation), recent: await snapshot(recentConversation) };
const oldPoll = await poll('2026-09-14T18:30:00.000Z');
const recentStabilization = await poll('2026-09-14T18:30:00.000Z');
const beforeRelease = await snapshot(recentConversation);
const release = await poll('2026-09-14T18:59:00.000Z');
const after = { old: await snapshot(oldConversation), recent: await snapshot(recentConversation) };

const oldRow = captured.old.rows[0];
const recentRow = after.recent.rows[0];
const assertions = {
  old_contact_phone_not_evidence: oldRow?.qualification_snapshot?.phone === '',
  old_reactivation_stays_partial: oldRow?.status === 'partial',
  old_phone_not_sent_to_dealeradmin: !oldRow?.dealer_id && captured.old.rows.length === 1,
  old_lead_dealers_not_created: captured.old.rows.every((row) => !row.dealer_id),
  old_no_conversation_phone_history: captured.old.messages.length === 1 && captured.old.events.length === 3,
  recent_phone_is_evidence: after.recent.rows[0]?.qualification_snapshot?.phone === recentCanonicalPhone,
  recent_case_queues: recentRow?.status === 'queued',
  recent_case_has_dealer_row: Boolean(recentRow?.dealer_id),
  recent_case_messages_kept: after.recent.messages.length === 2,
  recent_case_events_processed: after.recent.events.filter((event) => event.event_id.includes(`${NS}-recent-`) && event.status === 'processed').length === 2,
  same_phone_is_not_rejected_when_recent: recentRow?.qualification_snapshot?.phone === recentCanonicalPhone,
};
const result = Object.values(assertions).every(Boolean) ? 'PASS' : 'FAIL';
const evidence = {
  run_id: NS,
  generated_at: new Date().toISOString(),
  environment: { api_url: API, database: 'local PostgreSQL in user-provided Docker container', timezone: 'America/Bogota', secret_printed: false },
  rule: 'GHL contact phone is eligible only when the same number appears in an inbound message no older than three days at reconciliation time.',
  before,
  steps,
  captured,
  old_poll: oldPoll,
  recent_stabilization: recentStabilization,
  before_release: beforeRelease,
  release,
  after,
  verification_sql: SQL,
  assertions,
  result,
};
await mkdir('tmp/qa-recent-phone-20260913', { recursive: true });
await writeFile('tmp/qa-recent-phone-20260913/evidence.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ result, assertions, final: {
  old_status: after.old.rows[0]?.status,
  old_snapshot_phone: after.old.rows[0]?.qualification_snapshot?.phone,
  old_canonical_phone: after.old.rows[0]?.canonical_phone,
  recent_status: after.recent.rows[0]?.status,
  recent_snapshot_phone: after.recent.rows[0]?.qualification_snapshot?.phone,
  recent_canonical_phone: after.recent.rows[0]?.canonical_phone,
  recent_dealer: after.recent.rows[0]?.assigned_dealer_id,
} }, null, 2));
await pool.end();
if (result !== 'PASS') process.exitCode = 1;
