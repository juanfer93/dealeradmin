import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Register Arlington Motors of Woodbridge as a source dealer.
 *
 * This dealer behaves like the non-Easterns/Offlease sources: the GHL
 * location is authoritative and the webhook must not send the lead through
 * Easterns geographic routing.
 */
export class ArlingtonWoodbridgeDealer1710000015000 implements MigrationInterface {
  name = 'ArlingtonWoodbridgeDealer1710000015000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES (
        'd4444444-4444-4444-4444-444444444444',
        'ARL-WOOD',
        'Arlington Motors of Woodbridge',
        '9v8zH9Y5eLiiJwZTZDci',
        'America/New_York',
        true,
        '{}'::jsonb
      )
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
      WHERE id = 'd4444444-4444-4444-4444-444444444444'
    `);
  }
}
