import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenLeadDealerDocuments1710000011000 implements MigrationInterface {
  name = 'WidenLeadDealerDocuments1710000011000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN documents TYPE TEXT');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE lead_dealers ALTER COLUMN documents TYPE VARCHAR(250)');
  }
}
