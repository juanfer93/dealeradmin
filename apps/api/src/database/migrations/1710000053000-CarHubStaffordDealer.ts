import { MigrationInterface, QueryRunner } from 'typeorm';

/** Register CarHub Stafford as a Messenger-only GHL source dealer. */
export class CarHubStaffordDealer1710000053000 implements MigrationInterface {
  name = 'CarHubStaffordDealer1710000053000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES (
        'f3333333-3333-3333-3333-333333333333',
        'CARHUB-STAFFORD',
        'CarHub Stafford',
        'fVyKDmI0Il432etqbODo',
        'America/New_York',
        true,
        '{"channels":["messenger"]}'::jsonb
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
    await queryRunner.query(`
      INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
      VALUES ('fVyKDmI0Il432etqbODo', 'f3333333-3333-3333-3333-333333333333')
      ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dealer_location_aliases
      WHERE ghl_location_id = 'fVyKDmI0Il432etqbODo'
    `);
    await queryRunner.query(`
      DELETE FROM dealers
      WHERE id = 'f3333333-3333-3333-3333-333333333333'
    `);
  }
}
