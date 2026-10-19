import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowCrossDealerLeadPhones1710000039000 implements MigrationInterface {
  name = 'AllowCrossDealerLeadPhones1710000039000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The same person can legitimately be represented by separate leads in
    // different dealer locations. Duplicate prevention remains dealer-scoped.
    await queryRunner.query(`DROP INDEX IF EXISTS leads_canonical_phone_unique_idx`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS leads_canonical_phone_idx ON leads (canonical_phone)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS leads_canonical_phone_idx`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS leads_canonical_phone_unique_idx ON leads (canonical_phone) WHERE canonical_phone IS NOT NULL`);
  }
}
