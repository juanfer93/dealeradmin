import { MigrationInterface, QueryRunner } from 'typeorm';

/** Enable WhatsApp alongside Messenger for Arlington Motors of Woodbridge. */
export class EnableArlingtonWhatsApp1710000058000 implements MigrationInterface {
  name = 'EnableArlingtonWhatsApp1710000058000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET routing_config = COALESCE(routing_config, '{}'::jsonb)
        || '{"channels":["messenger","whatsapp"]}'::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE code = 'ARL-WOOD'
         OR ghl_location_id = '9v8zH9Y5eLiiJwZTZDci'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET routing_config = COALESCE(routing_config, '{}'::jsonb)
        || '{"channels":["messenger"]}'::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE code = 'ARL-WOOD'
         OR ghl_location_id = '9v8zH9Y5eLiiJwZTZDci'
    `);
  }
}
