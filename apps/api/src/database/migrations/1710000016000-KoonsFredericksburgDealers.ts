import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Register the Spanish and English Koons Fredericksburg locations as two
 * independent source dealers. Neither source uses Easterns geographic routing.
 */
export class KoonsFredericksburgDealers1710000016000 implements MigrationInterface {
  name = 'KoonsFredericksburgDealers1710000016000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES
        ('e5555555-5555-5555-5555-555555555555', 'KOONS-FRED', 'Koons de Fredericksburg', 'xuHo0opTO2g5edIuPJRl', 'America/New_York', true, '{}'::jsonb),
        ('e6666666-6666-6666-6666-666666666666', 'KOONS-FRED-ENG', 'Koons Automotive of Fredericksburg', 'ozAIEblxTjrh0PfoaHge', 'America/New_York', true, '{}'::jsonb)
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
      WHERE id IN ('e5555555-5555-5555-5555-555555555555', 'e6666666-6666-6666-6666-666666666666')
    `);
  }
}
