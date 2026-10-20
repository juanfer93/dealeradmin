import { MigrationInterface, QueryRunner } from 'typeorm';

export class GhlGuardRequestMetrics1710000040000 implements MigrationInterface {
  name = 'GhlGuardRequestMetrics1710000040000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS request_attempt_count INTEGER`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS request_elapsed_ms INTEGER`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS request_timeout_ms INTEGER`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS circuit_state VARCHAR(16)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_request_metrics_idx ON ghl_guard_logs (ghl_location_id, error_code, created_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ghl_guard_logs_request_metrics_idx`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS circuit_state`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS request_timeout_ms`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS request_elapsed_ms`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS request_attempt_count`);
  }
}
