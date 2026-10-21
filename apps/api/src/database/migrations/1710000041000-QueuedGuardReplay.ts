import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueuedGuardReplay1710000041000 implements MigrationInterface {
  name = 'QueuedGuardReplay1710000041000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS queued_guard_replay_count INTEGER NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE conversations
      ADD CONSTRAINT conversations_queued_guard_replay_count_nonnegative
      CHECK (queued_guard_replay_count >= 0)
    `).catch(async (error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes('already exists')) throw error;
    });
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_queued_guard_replay_count_nonnegative`);
    await queryRunner.query(`ALTER TABLE conversations DROP COLUMN IF EXISTS queued_guard_replay_count`);
  }
}
