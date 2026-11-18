import { MigrationInterface, QueryRunner } from 'typeorm';

export class WhatsAppUnverifiedSergioProfile1710000060000 implements MigrationInterface {
  name = 'WhatsAppUnverifiedSergioProfile1710000060000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO invalid_real_names (channel, normalized_value, display_value, reason)
      VALUES
        ('whatsapp', 'sergio echeverri', 'Sergio Echeverri', 'unverified_whatsapp_profile'),
        ('whatsapp', 'en mi trabajo', 'En Mi Trabajo', 'whatsapp_work_status_not_name')
      ON CONFLICT (channel, normalized_value) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM invalid_real_names
      WHERE channel = 'whatsapp'
        AND normalized_value IN ('sergio echeverri', 'en mi trabajo')
        AND reason IN ('unverified_whatsapp_profile', 'whatsapp_work_status_not_name')
    `);
  }
}
