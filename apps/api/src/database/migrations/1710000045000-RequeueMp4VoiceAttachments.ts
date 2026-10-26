import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reopens voice-note attachments that were rejected before the media worker
 * learned that GHL can deliver audio as a bare .mp4 URL.
 */
export class RequeueMp4VoiceAttachments1710000045000 implements MigrationInterface {
  name = 'RequeueMp4VoiceAttachments1710000045000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE conversation_attachments
      SET media_kind = 'audio',
          processing_status = 'pending',
          attempt_count = 0,
          next_attempt_at = NULL,
          error_code = NULL,
          processing_metadata = COALESCE(processing_metadata, '{}'::jsonb)
            || '{"repair":"requeued_mp4_voice_attachment"}'::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE media_kind = 'unknown'
        AND processing_status = 'not_retrievable'
        AND error_code = 'unsupported_media_kind'
        AND source_url ILIKE '%.mp4%'
        AND (content_type IS NULL OR content_type NOT ILIKE 'video/%')
    `);
  }

  async down(): Promise<void> {
    // This data repair is intentionally not reversed: reverting it would
    // reintroduce the production classification bug for already-recovered rows.
  }
}
