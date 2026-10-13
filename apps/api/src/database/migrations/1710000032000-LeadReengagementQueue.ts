import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadReengagementQueue1710000032000 implements MigrationInterface {
  name = 'LeadReengagementQueue1710000032000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lead_dealers
      ADD COLUMN IF NOT EXISTS has_unhandled_reengagement BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS lead_dealers_reengagement_idx
      ON lead_dealers (status, has_unhandled_reengagement)
      WHERE has_unhandled_reengagement = true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS lead_dealers_reengagement_idx`);
    await queryRunner.query(`ALTER TABLE lead_dealers DROP COLUMN IF EXISTS has_unhandled_reengagement`);
  }
}
