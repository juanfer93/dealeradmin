import { MigrationInterface, QueryRunner } from 'typeorm';

export class Conversations1710000014000 implements MigrationInterface {
  name = 'Conversations1710000014000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID NOT NULL REFERENCES leads(id),
        ghl_location_id VARCHAR NOT NULL,
        ghl_contact_id VARCHAR NOT NULL,
        ghl_conversation_id VARCHAR NOT NULL,
        channel VARCHAR(40) NOT NULL DEFAULT 'unknown',
        status VARCHAR(30) NOT NULL DEFAULT 'partial',
        qualification_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        location_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_message_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ready_at TIMESTAMPTZ,
        next_attempt_at TIMESTAMPTZ,
        dispatched_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT conversations_identity_unique UNIQUE (ghl_location_id, ghl_contact_id, ghl_conversation_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS conversations_lead_idx ON conversations (lead_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS conversations_due_idx ON conversations (status, next_attempt_at)`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        dedupe_key VARCHAR(250) NOT NULL,
        ghl_message_id VARCHAR,
        direction VARCHAR(20) NOT NULL DEFAULT 'inbound',
        body TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT conversation_messages_dedupe_unique UNIQUE (conversation_id, dedupe_key)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON conversation_messages (conversation_id, occurred_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS conversation_messages');
    await queryRunner.query('DROP TABLE IF EXISTS conversations');
  }
}
