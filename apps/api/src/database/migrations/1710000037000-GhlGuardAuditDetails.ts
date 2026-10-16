import { MigrationInterface, QueryRunner } from 'typeorm';

export class GhlGuardAuditDetails1710000037000 implements MigrationInterface {
  name = 'GhlGuardAuditDetails1710000037000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS lead_metadata JSONB`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs ADD COLUMN IF NOT EXISTS completed_fields JSONB`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS completed_fields`);
    await queryRunner.query(`ALTER TABLE ghl_guard_logs DROP COLUMN IF EXISTS lead_metadata`);
  }
}
