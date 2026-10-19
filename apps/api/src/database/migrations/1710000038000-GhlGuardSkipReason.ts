import { MigrationInterface, QueryRunner } from 'typeorm';

export class GhlGuardSkipReason1710000038000 implements MigrationInterface {
  name = 'GhlGuardSkipReason1710000038000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS skip_reason VARCHAR(64)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_skip_reason_idx ON ghl_guard_logs (skip_reason, created_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ghl_guard_logs_skip_reason_idx`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS skip_reason`);
  }
}
