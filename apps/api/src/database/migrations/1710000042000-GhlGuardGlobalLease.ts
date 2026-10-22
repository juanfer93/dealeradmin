import { MigrationInterface, QueryRunner } from 'typeorm';

export class GhlGuardGlobalLease1710000042000 implements MigrationInterface {
  name = 'GhlGuardGlobalLease1710000042000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ghl_guard_leases (
        lease_key VARCHAR(120) PRIMARY KEY,
        owner_id VARCHAR(64) NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL,
        lease_expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ghl_guard_leases_expiry_idx ON ghl_guard_leases (lease_expires_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ghl_guard_leases_expiry_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS ghl_guard_leases`);
  }
}
