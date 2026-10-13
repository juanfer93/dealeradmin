import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReengagementCount1710000033000 implements MigrationInterface {
  name = 'ReengagementCount1710000033000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lead_dealers
      ADD COLUMN IF NOT EXISTS reengagement_count INTEGER NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS lead_dealers_reengagement_count_idx
      ON lead_dealers (reengagement_count)
      WHERE reengagement_count > 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS lead_dealers_reengagement_count_idx`);
    await queryRunner.query(`ALTER TABLE lead_dealers DROP COLUMN IF EXISTS reengagement_count`);
  }
}
