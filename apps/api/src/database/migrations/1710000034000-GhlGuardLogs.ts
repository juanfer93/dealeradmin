import { MigrationInterface, QueryRunner } from 'typeorm';

export class GhlGuardLogs1710000034000 implements MigrationInterface {
  name = 'GhlGuardLogs1710000034000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ghl_guard_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL,
        ghl_location_id VARCHAR,
        ghl_contact_id VARCHAR,
        ghl_conversation_id VARCHAR,
        conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
        status VARCHAR(50) NOT NULL,
        fetched_message_count INTEGER NOT NULL DEFAULT 0,
        inserted_message_count INTEGER NOT NULL DEFAULT 0,
        repaired_message_count INTEGER NOT NULL DEFAULT 0,
        reconciled BOOLEAN NOT NULL DEFAULT false,
        duration_ms INTEGER,
        error_code VARCHAR(160),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_run_idx ON ghl_guard_logs (run_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_location_idx ON ghl_guard_logs (ghl_location_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_conversation_idx ON ghl_guard_logs (conversation_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_logs_status_idx ON ghl_guard_logs (status, created_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS ghl_guard_logs');
  }
}
