import { MigrationInterface, QueryRunner } from 'typeorm';

export class GhlGuardLeases1710000036000 implements MigrationInterface {
  name = 'GhlGuardLeases1710000036000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_retry_idx ON ghl_guard_logs (conversation_id, status, next_retry_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_lease_idx ON ghl_guard_logs (conversation_id, status, lease_expires_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ghl_guard_logs_lease_idx`);
    await queryRunner.query(`DROP INDEX IF EXISTS ghl_guard_logs_retry_idx`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS lease_expires_at`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS next_retry_at`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS attempt_count`);
  }
}
