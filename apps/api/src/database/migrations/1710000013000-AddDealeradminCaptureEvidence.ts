import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDealeradminCaptureEvidence1710000013000 implements MigrationInterface {
  name = 'AddDealeradminCaptureEvidence1710000013000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE webhook_events ADD COLUMN raw_transcript TEXT');
    await queryRunner.query('ALTER TABLE webhook_events ADD COLUMN capture_contract JSONB');
    await queryRunner.query('ALTER TABLE webhook_events ADD COLUMN capture_schema_version VARCHAR(80)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE webhook_events DROP COLUMN IF EXISTS capture_schema_version');
    await queryRunner.query('ALTER TABLE webhook_events DROP COLUMN IF EXISTS capture_contract');
    await queryRunner.query('ALTER TABLE webhook_events DROP COLUMN IF EXISTS raw_transcript');
  }
}
