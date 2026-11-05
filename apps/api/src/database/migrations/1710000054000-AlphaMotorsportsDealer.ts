import { MigrationInterface, QueryRunner } from 'typeorm';

/** Register Alpha Motorsports of Manassas as a WhatsApp and Messenger GHL source dealer. */
export class AlphaMotorsportsDealer1710000054000 implements MigrationInterface {
  name = 'AlphaMotorsportsDealer1710000054000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES (
        'f4444444-4444-4444-4444-444444444444',
        'ALPHA-MOTORSPORTS',
        'Alpha Motorsports of Manassas',
        'PoaMOa1VgcgtnqUBv3EP',
        'America/New_York',
        true,
        '{"channels":["whatsapp","messenger"]}'::jsonb
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
      VALUES ('PoaMOa1VgcgtnqUBv3EP', 'f4444444-4444-4444-4444-444444444444')
      ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dealer_location_aliases
      WHERE ghl_location_id = 'PoaMOa1VgcgtnqUBv3EP'
    `);
    await queryRunner.query(`
      DELETE FROM dealers
      WHERE id = 'f4444444-4444-4444-4444-444444444444'
    `);
  }
}
