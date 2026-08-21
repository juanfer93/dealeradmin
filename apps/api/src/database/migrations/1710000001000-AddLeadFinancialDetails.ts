import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadFinancialDetails1710000001000 implements MigrationInterface {
  name = 'AddLeadFinancialDetails1710000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE lead_dealers ADD COLUMN identification VARCHAR(120) NOT NULL DEFAULT ''");
    await queryRunner.query("ALTER TABLE lead_dealers ADD COLUMN bank_account VARCHAR(160) NOT NULL DEFAULT ''");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE lead_dealers DROP COLUMN IF EXISTS bank_account');
    await queryRunner.query('ALTER TABLE lead_dealers DROP COLUMN IF EXISTS identification');
  }
}
