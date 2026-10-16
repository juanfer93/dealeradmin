import { MigrationInterface, QueryRunner } from 'typeorm';

export class GhlGuardLifecycle1710000035000 implements MigrationInterface {
  name = 'GhlGuardLifecycle1710000035000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS http_status INTEGER`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS request_path TEXT`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS response_payload JSONB`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_scheduled_idx ON ghl_guard_logs (scheduled_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ghl_guard_logs_scheduled_idx`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS response_payload`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS request_path`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS http_status`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS finished_at`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS started_at`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS scheduled_at`);
  }
}
