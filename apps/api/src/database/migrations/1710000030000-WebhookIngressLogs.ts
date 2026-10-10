import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebhookIngressLogs1710000030000 implements MigrationInterface {
  name = 'WebhookIngressLogs1710000030000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_ingress_logs (
        request_id UUID PRIMARY KEY,
        method VARCHAR(12) NOT NULL,
        path VARCHAR(500) NOT NULL,
        source VARCHAR(120),
        event_id VARCHAR(250),
        event_type VARCHAR(120),
        ghl_location_id VARCHAR(120),
        ghl_contact_id VARCHAR(250),
        ghl_conversation_id VARCHAR(250),
        payload_hash VARCHAR(64) NOT NULL,
        raw_body TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        safe_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
        auth_status VARCHAR(30) NOT NULL DEFAULT 'unknown',
        auth_reason VARCHAR(120),
        handler_started_at TIMESTAMPTZ,
        status_code INTEGER,
        outcome VARCHAR(30) NOT NULL DEFAULT 'received',
        error_code VARCHAR(500),
        received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ,
        duration_ms INTEGER
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS webhook_ingress_received_idx ON webhook_ingress_logs (received_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS webhook_ingress_event_idx ON webhook_ingress_logs (event_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS webhook_ingress_hash_idx ON webhook_ingress_logs (payload_hash)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS webhook_ingress_outcome_idx ON webhook_ingress_logs (outcome, received_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS webhook_ingress_logs');
  }
}
