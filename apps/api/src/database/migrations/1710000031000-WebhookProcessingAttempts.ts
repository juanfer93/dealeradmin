import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebhookProcessingAttempts1710000031000 implements MigrationInterface {
  name = 'WebhookProcessingAttempts1710000031000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_processing_attempts (
        attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID,
        event_id VARCHAR(250),
        event_type VARCHAR(120),
        source VARCHAR(120),
        ghl_location_id VARCHAR(120),
        ghl_contact_id VARCHAR(250),
        ghl_conversation_id VARCHAR(250),
        ghl_message_id VARCHAR(250),
        processing_status VARCHAR(40) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        persisted_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        duration_ms INTEGER,
        error_code VARCHAR(500),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS webhook_processing_request_idx ON webhook_processing_attempts (request_id, completed_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS webhook_processing_event_idx ON webhook_processing_attempts (event_id, completed_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS webhook_processing_contact_idx ON webhook_processing_attempts (ghl_contact_id, completed_at)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS webhook_processing_status_idx ON webhook_processing_attempts (processing_status, completed_at)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS webhook_processing_attempts');
  }
}
