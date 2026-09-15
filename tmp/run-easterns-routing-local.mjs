import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('../apps/api/node_modules/pg');
const { EASTERN_DEALER_IDS, GeoroutingService } = require('../apps/api/dist/apps/api/src/features/routing/domain/services/georouting.service.js');

const databaseUrl = process.env.LOCAL_ROUTING_DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const tag = `codex-routing-${Date.now()}`;
const ghlLocationId = `${tag}-ghl-location`;
const conversations = JSON.parse(readFileSync(new URL('./easterns-routing-conversations-20260915.json', import.meta.url), 'utf8'));
const expected = [
  EASTERN_DEALER_IDS.rosedale,
  EASTERN_DEALER_IDS.laurel,
  EASTERN_DEALER_IDS.laurel,
  EASTERN_DEALER_IDS.rosedale,
  EASTERN_DEALER_IDS.laurel,
  EASTERN_DEALER_IDS.sterling,
  EASTERN_DEALER_IDS.sterling,
  EASTERN_DEALER_IDS.rosedale,
  EASTERN_DEALER_IDS.laurel,
  EASTERN_DEALER_IDS.laurel,
];

const client = new Client({ connectionString: databaseUrl });
const leadIds = [];

try {
  await client.connect();
  const dealers = await client.query(
    'SELECT id FROM dealers WHERE id = ANY($1::uuid[])',
    [Object.values(EASTERN_DEALER_IDS)],
  );
  if (dealers.rowCount !== 3) throw new Error('Faltan los tres dealers Easterns en la BD local');

  const queryClient = {
    query: async (...args) => (await client.query(...args)).rows,
  };
  const service = new GeoroutingService(queryClient);
  const results = [];
  for (let index = 0; index < conversations.length; index += 1) {
    const conversation = conversations[index];
    const result = await service.resolveDealer({
      city: conversation.city,
      state: conversation.state,
      easterns_zone: conversation.easterns_zone,
      easterns_dealer_selected: conversation.easterns_dealer_selected,
    }, queryClient, EASTERN_DEALER_IDS.rosedale, ghlLocationId);
    results.push({ id: conversation.id, dealerId: result.dealerId, reason: result.reason });
    if (result.dealerId !== expected[index]) {
      throw new Error(`La conversación ${conversation.id} esperaba ${expected[index]} y recibió ${result.dealerId}`);
    }

    const lead = (await client.query(
      `INSERT INTO leads (first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['Codex', conversation.id, `${tag}-${conversation.id}`, ghlLocationId, 'codex local routing test'],
    )).rows[0];
    leadIds.push(lead.id);
    await client.query(
      `INSERT INTO lead_dealers
         (lead_id, dealer_id, easterns_zone, assigned_dealer_id, routing_override, routing_reason, routing_status, status)
       VALUES ($1, $2, $3, $4, false, $5, 'resolved', 'pending')`,
      [lead.id, EASTERN_DEALER_IDS.rosedale, conversation.easterns_zone || '', result.dealerId, result.reason],
    );
  }

  console.log(JSON.stringify({ ok: true, count: results.length, results }, null, 2));
} finally {
  if (leadIds.length > 0) {
    await client.query('DELETE FROM lead_dealers WHERE lead_id = ANY($1::uuid[])', [leadIds]);
    await client.query('DELETE FROM leads WHERE id = ANY($1::uuid[])', [leadIds]);
  }
  await client.end();
}
