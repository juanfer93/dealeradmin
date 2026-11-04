import { MigrationInterface, QueryRunner } from 'typeorm';

/** Register Country Club Cars Inc as a WhatsApp-only GHL source dealer. */
export class CountryClubCarsDealer1710000050000 implements MigrationInterface {
  name = 'CountryClubCarsDealer1710000050000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES (
        'f1111111-1111-1111-1111-111111111111',
        'COUNTRY-CLUB',
        'Country Club Cars Inc',
        'k9DePpsNBu9qWT1C6pW0',
        'America/New_York',
        true,
        '{"channels":["whatsapp"]}'::jsonb
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
      VALUES ('k9DePpsNBu9qWT1C6pW0', 'f1111111-1111-1111-1111-111111111111')
      ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dealer_location_aliases
      WHERE ghl_location_id = 'k9DePpsNBu9qWT1C6pW0'
    `);
    await queryRunner.query(`
      DELETE FROM dealers
      WHERE id = 'f1111111-1111-1111-1111-111111111111'
    `);
  }
}
