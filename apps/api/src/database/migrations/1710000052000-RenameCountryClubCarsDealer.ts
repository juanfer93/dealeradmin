import { MigrationInterface, QueryRunner } from 'typeorm';

/** Align the persisted Country Club dealer name with the public dealer name. */
export class RenameCountryClubCarsDealer1710000052000 implements MigrationInterface {
  name = 'RenameCountryClubCarsDealer1710000052000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET name = 'Country Club Cars Inc', updated_at = CURRENT_TIMESTAMP
      WHERE code = 'COUNTRY-CLUB'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dealers
      SET name = 'Country Club Cars', updated_at = CURRENT_TIMESTAMP
      WHERE code = 'COUNTRY-CLUB'
    `);
  }
}
