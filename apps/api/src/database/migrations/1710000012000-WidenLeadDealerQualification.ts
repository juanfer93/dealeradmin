import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Qualification is optional at intake, so its free-form values must not make
 * an otherwise valid phone lead fail during persistence.
 */
export class WidenLeadDealerQualification1710000012000 implements MigrationInterface {
  name = 'WidenLeadDealerQualification1710000012000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN vehicle_type TYPE TEXT');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN down_payment TYPE TEXT');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN purchase_timeline TYPE TEXT');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN identification TYPE TEXT');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN bank_account TYPE TEXT');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN documents TYPE TEXT');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN easterns_zone TYPE TEXT');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN easterns_zone TYPE VARCHAR(120)');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN documents TYPE VARCHAR(250)');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN bank_account TYPE VARCHAR(160)');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN identification TYPE VARCHAR(120)');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN purchase_timeline TYPE VARCHAR(40)');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN down_payment TYPE VARCHAR(120)');
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN vehicle_type TYPE VARCHAR(80)');
  }
}
