import { MigrationInterface, QueryRunner } from 'typeorm';

/** Register the final Easterns Messenger sources and their direct queues. */
export class EasternsMillersvilleAndFrederickDealers1710000019000 implements MigrationInterface {
  name = 'EasternsMillersvilleAndFrederickDealers1710000019000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Millersville and White Marsh share one GHL source and alternate through
    // a durable counter so concurrent messages cannot select the same queue.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dealer_round_robin_state (
        allocation_key VARCHAR(120) PRIMARY KEY,
        next_index INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      INSERT INTO dealer_round_robin_state (allocation_key, next_index)
      VALUES ('easterns-millersville', 0)
      ON CONFLICT (allocation_key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES
        ('eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EAST-MILLERSVILLE', 'Easterns Millersville', '113zMWQlhKKBUu5wOYtR', 'America/New_York', true, '{"group":"Easterns Direct","allocation_key":"easterns-millersville","allocation_order":0}'::jsonb),
        ('ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'EAST-WHITE-MARSH', 'Easterns Nissan of White Marsh', '113zMWQlhKKBUu5wOYtR', 'America/New_York', true, '{"group":"Easterns Direct","allocation_key":"easterns-millersville","allocation_order":1}'::jsonb),
        ('eccccccc-cccc-cccc-cccc-cccccccccccc', 'EAST-FREDERICK', 'Easterns Frederick', 'MRHcOwdTqaN5cug3eSWW', 'America/New_York', true, '{"group":"Easterns Direct"}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code,
        name = EXCLUDED.name,
        ghl_location_id = EXCLUDED.ghl_location_id,
        timezone = EXCLUDED.timezone,
        active = EXCLUDED.active,
        routing_config = EXCLUDED.routing_config,
        updated_at = CURRENT_TIMESTAMP
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dealers
      WHERE id IN (
        'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'eccccccc-cccc-cccc-cccc-cccccccccccc'
      )
    `);
    await queryRunner.query(`DELETE FROM dealer_round_robin_state WHERE allocation_key = 'easterns-millersville'`);
    await queryRunner.query(`DROP TABLE IF EXISTS dealer_round_robin_state`);
  }
}
