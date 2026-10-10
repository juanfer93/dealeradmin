import { MigrationInterface, QueryRunner } from 'typeorm';

/** Enable Messenger beside the existing WhatsApp channel for Stafford. */
export class EnableStaffordMessenger1710000029000 implements MigrationInterface {
  name = 'EnableStaffordMessenger1710000029000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET routing_config = COALESCE(routing_config, '{}'::jsonb)
        || '{"channels":["whatsapp","messenger"]}'::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE code = 'STAFFORD'
         OR ghl_location_id = 'LiaoSID3nvAhad49ZpNJ'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET routing_config = COALESCE(routing_config, '{}'::jsonb) - 'channels',
          updated_at = CURRENT_TIMESTAMP
      WHERE code = 'STAFFORD'
         OR ghl_location_id = 'LiaoSID3nvAhad49ZpNJ'
    `);
  }
}
