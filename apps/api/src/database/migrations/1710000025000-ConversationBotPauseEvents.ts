import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationBotPauseEvents1710000025000 implements MigrationInterface {
  name = 'ConversationBotPauseEvents1710000025000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversation_bot_pause_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id VARCHAR(120) NOT NULL,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        transition_number INTEGER NOT NULL,
        ghl_conversation_id VARCHAR NOT NULL,
        ghl_contact_id VARCHAR NOT NULL,
        ghl_location_id VARCHAR NOT NULL,
        lead_id UUID NOT NULL REFERENCES leads(id),
        queued BOOLEAN NOT NULL DEFAULT TRUE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        pause_hours INTEGER NOT NULL DEFAULT 24,
        emitted_at TIMESTAMPTZ NOT NULL,
        pause_until TIMESTAMPTZ NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT conversation_bot_pause_events_event_id_unique UNIQUE (event_id),
        CONSTRAINT conversation_bot_pause_events_transition_unique UNIQUE (conversation_id, transition_number),
        CONSTRAINT conversation_bot_pause_events_status_check CHECK (status IN ('pending', 'sent', 'failed')),
        CONSTRAINT conversation_bot_pause_events_pause_hours_check CHECK (pause_hours = 24)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS conversation_bot_pause_events_delivery_idx ON conversation_bot_pause_events (status, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS conversation_bot_pause_events_location_idx ON conversation_bot_pause_events (ghl_location_id, created_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS conversation_bot_pause_events');
  }
}
