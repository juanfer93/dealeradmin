import { MigrationInterface, QueryRunner } from 'typeorm';

export class QualificationWaitingWindowAttempts1710000044000 implements MigrationInterface {
  name = 'QualificationWaitingWindowAttempts1710000044000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS waiting_window_attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS waiting_window_started_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS conversations_waiting_window_attempts_idx
      ON conversations (status, next_attempt_at, waiting_window_attempts)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS conversations_waiting_window_attempts_idx');
    await queryRunner.query(`
      ALTER TABLE conversations
        DROP COLUMN IF EXISTS waiting_window_started_at,
        DROP COLUMN IF EXISTS waiting_window_attempts
    `);
  }
}
