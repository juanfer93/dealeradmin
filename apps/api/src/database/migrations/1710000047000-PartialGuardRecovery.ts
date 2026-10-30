import { MigrationInterface, QueryRunner } from 'typeorm';

export class PartialGuardRecovery1710000047000 implements MigrationInterface {
  name = 'PartialGuardRecovery1710000047000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS partial_recovery_attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS partial_recovery_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS partial_recovery_next_attempt_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      UPDATE conversations
      SET partial_recovery_started_at = COALESCE(partial_recovery_started_at, last_message_at, created_at),
          partial_recovery_next_attempt_at = COALESCE(
            partial_recovery_next_attempt_at,
            COALESCE(last_message_at, created_at) + INTERVAL '30 minutes'
          )
      WHERE status = 'partial'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS conversations_partial_recovery_idx
      ON conversations (status, partial_recovery_next_attempt_at, partial_recovery_attempts)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS conversations_partial_recovery_idx');
    await queryRunner.query(`
      ALTER TABLE conversations
        DROP COLUMN IF EXISTS partial_recovery_next_attempt_at,
        DROP COLUMN IF EXISTS partial_recovery_started_at,
        DROP COLUMN IF EXISTS partial_recovery_attempts
    `);
  }
}
