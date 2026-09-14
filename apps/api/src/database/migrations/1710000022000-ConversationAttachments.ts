import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationAttachments1710000022000 implements MigrationInterface {
  name = 'ConversationAttachments1710000022000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversation_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        conversation_message_id UUID NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
        ghl_location_id VARCHAR NOT NULL,
        ghl_conversation_id VARCHAR NOT NULL,
        ghl_message_id VARCHAR NOT NULL,
        source_url TEXT,
        source_url_expires_at TIMESTAMPTZ,
        content_type VARCHAR(160),
        media_kind VARCHAR(20) NOT NULL DEFAULT 'unknown',
        original_filename TEXT,
        byte_size BIGINT,
        sha256 VARCHAR(64),
        processing_status VARCHAR(30) NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        extracted_text TEXT,
        processing_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT conversation_attachments_kind_check CHECK (media_kind IN ('audio', 'image', 'unknown')),
        CONSTRAINT conversation_attachments_status_check CHECK (processing_status IN ('pending', 'processing', 'done', 'failed', 'not_retrievable'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_attachments_message_url_unique
      ON conversation_attachments (conversation_message_id, source_url)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_attachments_message_hash_unique
      ON conversation_attachments (ghl_message_id, sha256)
      WHERE sha256 IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS conversation_attachments_worker_idx
      ON conversation_attachments (processing_status, next_attempt_at, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS conversation_attachments_conversation_idx
      ON conversation_attachments (conversation_id, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS conversation_attachments');
  }
}
