import { MigrationInterface, QueryRunner } from 'typeorm';

export class PartialGuardRecoveryLimit1710000048000 implements MigrationInterface {
  name = 'PartialGuardRecoveryLimit1710000048000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS partial_recovery_enabled BOOLEAN NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      UPDATE conversations
      SET partial_recovery_enabled = (
        status = 'partial'
        AND COALESCE(partial_recovery_attempts, 0) < 10
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
        DROP COLUMN IF EXISTS partial_recovery_enabled
    `);
  }
}
