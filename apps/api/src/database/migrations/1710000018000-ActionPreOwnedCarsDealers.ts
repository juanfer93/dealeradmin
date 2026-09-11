import { MigrationInterface, QueryRunner } from 'typeorm';

/** Register Action Pre Owned Cars as two language-specific dealerADMIN queues. */
export class ActionPreOwnedCarsDealers1710000018000 implements MigrationInterface {
  name = 'ActionPreOwnedCarsDealers1710000018000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // A single GHL location is intentionally shared by the two language queues.
    await queryRunner.query(`ALTER TABLE dealers DROP CONSTRAINT IF EXISTS dealers_ghl_location_id_key`);
    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES
        ('e8888888-8888-8888-8888-888888888888', 'ACTION-CARS-ES', 'Action Pre Owned Cars Español', 'ZxadcudjvBz7KFCB1od4', 'America/New_York', true, '{"group":"Action Pre Owned Cars","language":"es"}'::jsonb),
        ('e9999999-9999-9999-9999-999999999999', 'ACTION-CARS-EN', 'Action Pre Owned Cars English', 'ZxadcudjvBz7KFCB1od4', 'America/New_York', true, '{"group":"Action Pre Owned Cars","language":"en"}'::jsonb)
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
      WHERE id IN ('e8888888-8888-8888-8888-888888888888', 'e9999999-9999-9999-9999-999999999999')
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS dealers_ghl_location_id_key ON dealers (ghl_location_id)`);
  }
}
