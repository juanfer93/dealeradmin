import { MigrationInterface, QueryRunner } from 'typeorm';

/** Temporarily hides White Marsh while preserving its dealer and round-robin configuration. */
export class TemporarilyHideEasternsWhiteMarsh1710000049000 implements MigrationInterface {
  name = 'TemporarilyHideEasternsWhiteMarsh1710000049000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET active = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 'ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        AND code = 'EAST-WHITE-MARSH'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET active = true,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 'ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        AND code = 'EAST-WHITE-MARSH'
    `);
  }
}
