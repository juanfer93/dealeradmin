import { MigrationInterface, QueryRunner } from 'typeorm';

/** Restore source aliases on databases where the original alias migration was recorded but drifted. */
export class RepairCustomerRepliedSourceAliases1710000020000 implements MigrationInterface {
  name = 'RepairCustomerRepliedSourceAliases1710000020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
      SELECT 'MyxWNKacThim798E8KC6', d.id
      FROM dealers d
      WHERE d.code = 'DLR-FRED-001' AND d.active = true
      ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id
    `);
    await queryRunner.query(`
      INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
      SELECT 'bAuMEQeH48xAtu9tAMFf', d.id
      FROM dealers d
      WHERE d.code = 'DLR-FRED-002' AND d.active = true
      ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dealer_location_aliases
      WHERE ghl_location_id IN ('MyxWNKacThim798E8KC6', 'bAuMEQeH48xAtu9tAMFf')
    `);
  }
}
