import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireApiDependency('pg');

const API = process.env.QA_API_URL || 'http://127.0.0.1:3015';
const DB = process.env.DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const HMAC = process.env.QA_HMAC_SECRET;
if (!HMAC) throw new Error('QA_HMAC_SECRET must be injected by the test process.');

const NS = `qa-random-all-cases-20260920-${Date.now()}`;
const NOW = new Date().toISOString();
const OUT = new URL('./evidence.json', import.meta.url);
const sources = [
  ['stafford', 'whatsapp', true],
  ['fredericksburg', 'messenger', true],
  ['fredericksburg-2', 'messenger', true],
  ['easterns', 'messenger', false],
  ['arlington', 'messenger', false],
  ['koons-fred', 'messenger', false],
  ['koons-fred-eng', 'messenger', false],
  ['koons-culpeper', 'messenger', false],
  ['action-cars', 'messenger', false],
  ['easterns-millersville', 'messenger', false],
  ['easterns-frederick', 'messenger', false],
];

const pool = new Pool({ connectionString: DB });
const phoneFor = (index) => `+1240555${String(8000 + index).slice(-4)}`;
const nameFor = (source, kind) => `QA ${source.replaceAll('-', ' ')} ${kind}`;
const bodyFor = (source, kind, phone) => {
  const name = nameFor(source, kind);
  if (kind === 'qualified') {
    return source === 'stafford'
      ? `Hola soy ${name}. Busco una Toyota Tacoma, mi numero es ${phone}, tengo 3000 de enganche y compro esta semana.`
      : `${source === 'easterns' ? 'I live in Silver Spring MD. ' : ''}Busco una Honda Civic, tengo 3000 de enganche, mi numero es ${phone} y compro esta semana.`;
  }
  if (kind === 'promo-previous-financing') return `Soy ${name}. Busco una SUV. Mi numero es ${phone}. Tengo 1000 de enganche y ya he financiado antes.`;
  if (kind === 'trade-in-only') return `Soy ${name}. Busco una Tacoma, mi numero es ${phone}, tengo mi carro para entregar y compro esta semana.`;
  if (kind === 'trade-in-plus-down') return `Soy ${name}. Busco una Tacoma, mi numero es ${phone}, tengo 1000 y mi carro como enganche.`;
  if (kind === 'offlease-insufficient') return `Soy ${name}. Busco una troca Tacoma, mi numero es ${phone}, tengo 1000 de enganche y nunca he financiado.`;
  return `H0la, soy ${name}. Quiero una SUV pero todavia no tengo numero de telefono.`;
};

async function cleanup() {
  await pool.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)`, [`${NS}%`]);
  await pool.query(`DELETE FROM conversations WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM leads WHERE ghl_contact_id LIKE $1`, [`${NS}%`]);
  await pool.query(`DELETE FROM webhook_events WHERE event_id LIKE $1`, [`${NS}%`]);
}

async function send(source, channel, kind, index) {
  const caseId = `${NS}-${source}-${kind}`;
  const contactId = `${caseId}-contact`;
  const conversationId = `${caseId}-conversation`;
  const phone = phoneFor(index);
  const payload = {
    event_id: `${caseId}-event`,
    event_type: 'customer.replied',
    ghl_message_id: `${caseId}-message`,
    ghl_contact_id: contactId,
    ghl_conversation_id: conversationId,
    message_body: bodyFor(source, kind, phone),
    contact_phone: source === 'stafford' ? phone : '',
    contact_name: nameFor(source, kind),
    channel,
    occurred_at: NOW,
  };
  const raw = JSON.stringify(payload);
  const response = await fetch(`${API}/api/webhooks/ghl/customer-replied/${source}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(raw).digest('hex')}`,
      'X-DealerADMIN-Test-Now': NOW,
    },
    body: raw,
  });
  const responseBody = await response.json().catch(() => ({}));
  const dueNow = new Date(Date.parse(NOW) + 2 * 60 * 60 * 1000).toISOString();
  const dueRaw = '{}';
  const dueResponse = await fetch(`${API}/api/webhooks/ghl/conversations/process-due`, {
    method: 'POST',
    headers: {
      'X-GHL-Signature': `sha256=${createHmac('sha256', HMAC).update(dueRaw).digest('hex')}`,
      'content-type': 'application/json',
      'X-DealerADMIN-Test-Now': dueNow,
    },
    body: dueRaw,
  });
  const rows = (await pool.query(`
    SELECT c.status, c.qualification_snapshot, c.location_snapshot,
           l.canonical_phone, d.name AS dealer_name, ld.status AS dealer_status
    FROM conversations c
    JOIN leads l ON l.id = c.lead_id
    LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
    LEFT JOIN dealers d ON d.id = ld.dealer_id
    WHERE c.ghl_conversation_id = $1
    ORDER BY ld.created_at NULLS LAST`, [conversationId])).rows;
  const snapshot = rows[0]?.qualification_snapshot ?? {};
  const offlease = source === 'stafford' || source === 'fredericksburg' || source === 'fredericksburg-2';
  const expectedQueued = kind === 'qualified' || (offlease && ['promo-previous-financing', 'trade-in-only', 'trade-in-plus-down'].includes(kind));
  return {
    source, kind, case_id: caseId, http_status: response.status, webhook: responseBody,
    status: rows[0]?.status ?? null, dealer: rows[0]?.dealer_name ?? null,
    dealer_status: rows[0]?.dealer_status ?? null, canonical_phone: rows[0]?.canonical_phone ?? null,
    vehicle_type: snapshot.vehicle_type ?? null, down_payment: snapshot.down_payment ?? null,
    previous_financing: snapshot.previous_financing ?? null,
    predicted_bot_question: snapshot.qualification_progress?.predicted_bot_question ?? null,
    process_due_status: dueResponse.status,
    expected_queued: expectedQueued,
    pass: response.status === 201
      && (expectedQueued ? rows[0]?.status === 'queued' && rows.some((row) => row.dealer_status === 'pending') : rows[0]?.status !== 'queued'),
  };
}

async function main() {
  await pool.query('SELECT 1');
  await cleanup();
  const cases = [];
  let index = 0;
  for (const [source, channel, offlease] of sources) {
    for (const kind of ['qualified', 'incomplete']) {
      index += 1;
      cases.push(await send(source, channel, kind, index));
    }
    if (offlease) {
      for (const kind of ['promo-previous-financing', 'trade-in-only', 'trade-in-plus-down', 'offlease-insufficient']) {
        index += 1;
        cases.push(await send(source, channel, kind, index));
      }
    }
  }
  const summary = {
    result: cases.every((item) => item.pass) ? 'PASS' : 'FAIL',
    total: cases.length,
    passed: cases.filter((item) => item.pass).length,
    failed: cases.filter((item) => !item.pass).length,
    queued: cases.filter((item) => item.status === 'queued').length,
    not_queued: cases.filter((item) => item.status !== 'queued').length,
    generated_at: NOW,
  };
  const evidence = { run_id: NS, summary, cases, rules: {
    offlease: 'name + recent customer phone + concrete vehicle + down payment; $1000 allowed only with previous financing',
    non_offlease: 'name + recent customer phone + concrete vehicle; down payment does not block routing',
    queue: 'qualified cases must be queued with a pending dealer relation; incomplete cases must not be queued',
  }};
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(cases.map(({ source, kind, status, dealer, vehicle_type, down_payment, previous_financing, pass }) => ({ source, kind, status, dealer, vehicle_type, down_payment, previous_financing, pass })), null, 2));
  await cleanup();
  await pool.end();
  if (summary.result !== 'PASS') process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
