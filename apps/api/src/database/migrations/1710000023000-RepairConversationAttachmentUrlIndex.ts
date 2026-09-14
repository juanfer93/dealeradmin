import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairConversationAttachmentUrlIndex1710000023000 implements MigrationInterface {
  name = 'RepairConversationAttachmentUrlIndex1710000023000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS conversation_attachments_message_url_unique');
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_attachments_message_url_unique
      ON conversation_attachments (conversation_message_id, source_url)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS conversation_attachments_message_url_unique');
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_attachments_message_url_unique
      ON conversation_attachments (conversation_message_id, source_url)
      WHERE source_url IS NOT NULL
    `);
  }
}
