import { MigrationInterface, QueryRunner } from 'typeorm';

/** Register Koons Automotive of Culpeper as its own Messenger dealer source. */
export class KoonsCulpeperDealer1710000017000 implements MigrationInterface {
  name = 'KoonsCulpeperDealer1710000017000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES (
        'e7777777-7777-7777-7777-777777777777',
        'KOONS-CULPEPER',
        'Koons Automotive of Culpeper',
        'bTNJHpNZ8FaS1PUHkuUq',
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
      WHERE id = 'e7777777-7777-7777-7777-777777777777'
    `);
  }
}
