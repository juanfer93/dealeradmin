import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessengerInvalidRealNames1710000057000 implements MigrationInterface {
  name = 'MessengerInvalidRealNames1710000057000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE invalid_real_names DROP CONSTRAINT IF EXISTS invalid_real_names_channel_valid');
    await queryRunner.query(`ALTER TABLE invalid_real_names
      ADD CONSTRAINT invalid_real_names_channel_valid CHECK (channel IN ('all', 'whatsapp', 'messenger'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM invalid_real_names WHERE channel = 'messenger'");
    await queryRunner.query('ALTER TABLE invalid_real_names DROP CONSTRAINT IF EXISTS invalid_real_names_channel_valid');
    await queryRunner.query(`ALTER TABLE invalid_real_names
      ADD CONSTRAINT invalid_real_names_channel_valid CHECK (channel IN ('all', 'whatsapp'))`);
  }
}
