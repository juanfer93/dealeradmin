import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadDeletionSuppressions1710000046000 implements MigrationInterface {
  name = 'LeadDeletionSuppressions1710000046000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lead_deletion_suppressions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ghl_location_id VARCHAR(120) NOT NULL,
        ghl_contact_id VARCHAR(250) NOT NULL,
        canonical_phone VARCHAR,
        reason VARCHAR(120) NOT NULL DEFAULT 'operator_delete',
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT lead_deletion_suppressions_identity_unique UNIQUE (ghl_location_id, ghl_contact_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS lead_deletion_suppressions_contact_idx ON lead_deletion_suppressions (ghl_location_id, ghl_contact_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS lead_deletion_suppressions_phone_idx ON lead_deletion_suppressions (ghl_location_id, canonical_phone)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS lead_deletion_suppressions');
  }
}
