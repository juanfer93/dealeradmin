import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvalidWhatsAppProfileNames1710000061000 implements MigrationInterface {
  name = 'InvalidWhatsAppProfileNames1710000061000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO invalid_real_names (channel, normalized_value, display_value, reason)
      VALUES
        ('whatsapp', 'buco', 'Buco', 'unverified_whatsapp_profile'),
        ('whatsapp', 'buenas', 'Buenas', 'whatsapp_greeting_not_name')
      ON CONFLICT (channel, normalized_value) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM invalid_real_names
      WHERE channel = 'whatsapp'
        AND normalized_value IN ('buco', 'buenas')
        AND reason IN ('unverified_whatsapp_profile', 'whatsapp_greeting_not_name')
    `);
  }
}
