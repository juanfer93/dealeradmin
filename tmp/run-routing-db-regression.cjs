const { DataSource } = require('../apps/api/node_modules/typeorm');
const { GeoroutingService, EASTERN_DEALER_IDS } = require('../apps/api/dist/apps/api/src/features/routing/domain/services/georouting.service.js');
const { ConversationWebhookService } = require('../apps/api/dist/apps/api/src/features/webhooks/application/conversation-webhook.service.js');

const databaseUrl = process.env.ROUTING_QA_DATABASE_URL || 'postgresql://dealeradmin:dealeradmin_local@127.0.0.1:5432/dealeradmin';
const easternsLocationId = 'xN2LSSl62okzv9GnOJPU';
const millersvilleLocationId = '113zMWQlhKKBUu5wOYtR';
const actionCarsLocationId = 'ZxadcudjvBz7KFCB1od4';

function dealerName(id) {
  return Object.entries(EASTERN_DEALER_IDS).find(([, value]) => value === id)?.[0] || id;
}

async function main() {
  const dataSource = new DataSource({ type: 'postgres', url: databaseUrl });
  await dataSource.initialize();
  const geo = new GeoroutingService(dataSource);
  const service = new ConversationWebhookService();
  const results = [];

  async function check(name, actual, expected) {
    const pass = actual === expected;
    results.push({ name, actual, expected, pass });
    if (!pass) throw new Error(`${name}: expected ${expected}, received ${actual}`);
  }

  try {
    await check('Virginia exclusive zone -> Sterling',
      (await geo.resolveDealer({ city: 'Chantilly', state: 'VA' })).dealerId,
      EASTERN_DEALER_IDS.sterling);
    await check('Maryland Laurel exclusive zone -> Laurel',
      (await geo.resolveDealer({ city: 'Laurel', state: 'MD' })).dealerId,
      EASTERN_DEALER_IDS.laurel);
    await check('Delaware exclusive zone -> Rosedale',
      (await geo.resolveDealer({ city: 'Wilmington', state: 'DE' })).dealerId,
      EASTERN_DEALER_IDS.rosedale);
    await check('Pennsylvania exclusive zone -> Rosedale',
      (await geo.resolveDealer({ city: 'Philadelphia', state: 'PA' })).dealerId,
      EASTERN_DEALER_IDS.rosedale);
    await check('New York exclusive zone -> Rosedale',
      (await geo.resolveDealer({ city: 'New York City', state: 'NY' })).dealerId,
      EASTERN_DEALER_IDS.rosedale);
    await check('New Jersey exclusive zone -> Rosedale',
      (await geo.resolveDealer({ city: 'Jersey City', state: 'NJ' })).dealerId,
      EASTERN_DEALER_IDS.rosedale);
    await check('DC exclusive zone -> Sterling',
      (await geo.resolveDealer({ city: 'Washington', state: 'DC' })).dealerId,
      EASTERN_DEALER_IDS.sterling);

    const baltimoreHistory = await dataSource.query(
      `SELECT ld.assigned_dealer_id
       FROM lead_dealers ld
       INNER JOIN leads l ON l.id = ld.lead_id
       WHERE ld.assigned_dealer_id = ANY($1::uuid[])
         AND ld.routing_reason LIKE 'Baltimore Overlap:%'
         AND l.ghl_location_id = $2
       ORDER BY COALESCE(ld.updated_at, ld.created_at) DESC, ld.created_at DESC, ld.lead_id DESC
       LIMIT 1`,
      [[EASTERN_DEALER_IDS.rosedale, EASTERN_DEALER_IDS.laurel], easternsLocationId],
    );
    const lastBaltimore = baltimoreHistory[0]?.assigned_dealer_id || null;
    const expectedBaltimore = lastBaltimore === EASTERN_DEALER_IDS.rosedale
      ? EASTERN_DEALER_IDS.laurel
      : EASTERN_DEALER_IDS.rosedale;
    await check(`Baltimore round robin alternates after ${dealerName(lastBaltimore)}`,
      (await geo.resolveDealer({ city: 'Baltimore', state: 'MD' }, dataSource, undefined, easternsLocationId)).dealerId,
      expectedBaltimore);

    const southernHistory = await dataSource.query(
      `SELECT ld.assigned_dealer_id
       FROM lead_dealers ld
       INNER JOIN leads l ON l.id = ld.lead_id
       WHERE ld.assigned_dealer_id = ANY($1::uuid[])
         AND ld.routing_reason LIKE 'Southern MD/DC Overlap:%'
         AND l.ghl_location_id = $2
       ORDER BY COALESCE(ld.updated_at, ld.created_at) DESC, ld.created_at DESC, ld.lead_id DESC
       LIMIT 1`,
      [[EASTERN_DEALER_IDS.laurel, EASTERN_DEALER_IDS.sterling], easternsLocationId],
    );
    const lastSouthern = southernHistory[0]?.assigned_dealer_id || null;
    const expectedSouthern = lastSouthern === EASTERN_DEALER_IDS.laurel
      ? EASTERN_DEALER_IDS.sterling
      : EASTERN_DEALER_IDS.laurel;
    await check(`Southern Maryland round robin alternates after ${dealerName(lastSouthern)}`,
      (await geo.resolveDealer({ city: 'Waldorf', state: 'MD' }, dataSource, undefined, easternsLocationId)).dealerId,
      expectedSouthern);

    const stateRows = await dataSource.query(
      `SELECT next_index FROM dealer_round_robin_state WHERE allocation_key = 'easterns-millersville'`,
    );
    const startingIndex = Number(stateRows[0]?.next_index || 0) % 2;
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const first = await service.findSourceDealer(runner, millersvilleLocationId, 'easterns-millersville');
      const second = await service.findSourceDealer(runner, millersvilleLocationId, 'easterns-millersville');
      const ordered = startingIndex === 0
        ? ['EAST-MILLERSVILLE', 'EAST-WHITE-MARSH']
        : ['EAST-WHITE-MARSH', 'EAST-MILLERSVILLE'];
      await check('Millersville/Nissan White Marsh round robin first turn', first.code, ordered[0]);
      await check('Millersville/Nissan White Marsh round robin second turn', second.code, ordered[1]);
      await check('Millersville/Nissan White Marsh alternates dealers', `${first.code}->${second.code}`, `${ordered[0]}->${ordered[1]}`);

      const spanish = await service.findSourceDealer(runner, actionCarsLocationId, 'action-cars', 'es');
      const english = await service.findSourceDealer(runner, actionCarsLocationId, 'action-cars', 'en');
      await check('Action Cars Spanish -> Español', spanish.code, 'ACTION-CARS-ES');
      await check('Action Cars English -> English', english.code, 'ACTION-CARS-EN');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }

    const summary = { total: results.length, passed: results.filter((item) => item.pass).length, failed: results.filter((item) => !item.pass).length, results };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed !== 0) process.exitCode = 1;
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
