import { MigrationInterface, QueryRunner } from 'typeorm';

export class MonthlyReportQueueArchive1710000026000 implements MigrationInterface {
  name = 'MonthlyReportQueueArchive1710000026000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lead_dealers
      ADD COLUMN IF NOT EXISTS queue_archived_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS lead_dealers_queue_archived_idx
      ON lead_dealers (status, queue_archived_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS lead_dealers_queue_archived_idx`);
    await queryRunner.query(`ALTER TABLE lead_dealers DROP COLUMN IF EXISTS queue_archived_at`);
  }
}
