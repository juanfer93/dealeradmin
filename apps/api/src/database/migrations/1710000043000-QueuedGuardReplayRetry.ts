import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueuedGuardReplayRetry1710000043000 implements MigrationInterface {
  name = 'QueuedGuardReplayRetry1710000043000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS queued_guard_replay_claimed_at TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_queued_guard_replay_claim
      ON conversations (queued_guard_replay_claimed_at)
      WHERE status = 'queued' AND queued_guard_replay_count = 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_conversations_queued_guard_replay_claim`);
    await queryRunner.query(`ALTER TABLE conversations DROP COLUMN IF EXISTS queued_guard_replay_claimed_at`);
  }
}
