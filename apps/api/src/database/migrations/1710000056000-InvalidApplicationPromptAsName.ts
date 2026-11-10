import { MigrationInterface, QueryRunner } from 'typeorm';

/** Prevent an application instruction from being retained as a WhatsApp name. */
export class InvalidApplicationPromptAsName1710000056000 implements MigrationInterface {
  name = 'InvalidApplicationPromptAsName1710000056000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO invalid_real_names (channel, normalized_value, display_value, reason)
      VALUES
        ('whatsapp', 'llene una solicitud en línea', 'Llene una solicitud en línea', 'not_a_personal_name'),
        ('whatsapp', 'llene una solicitud en linea', 'Llene una solicitud en linea', 'not_a_personal_name'),
        ('whatsapp', 'un saludo', 'Un Saludo', 'not_a_personal_name')
      ON CONFLICT (channel, normalized_value) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM invalid_real_names
      WHERE channel = 'whatsapp'
        AND normalized_value IN ('llene una solicitud en línea', 'llene una solicitud en linea', 'un saludo')
        AND reason = 'not_a_personal_name'
    `);
  }
}
