import { MigrationInterface, QueryRunner } from 'typeorm';

/** Register Lucki Mazda of Woodbridge as a WhatsApp-only GHL source dealer. */
export class LuckiMazdaDealer1710000051000 implements MigrationInterface {
  name = 'LuckiMazdaDealer1710000051000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES (
        'f2222222-2222-2222-2222-222222222222',
        'LUCKI-MAZDA',
        'Lucki Mazda of Woodbridge',
        'cd9Slb2Fk2vNY3l4ukG9',
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
      VALUES ('cd9Slb2Fk2vNY3l4ukG9', 'f2222222-2222-2222-2222-222222222222')
      ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dealer_location_aliases
      WHERE ghl_location_id = 'cd9Slb2Fk2vNY3l4ukG9'
    `);
    await queryRunner.query(`
      DELETE FROM dealers
      WHERE id = 'f2222222-2222-2222-2222-222222222222'
    `);
  }
}
