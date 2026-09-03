import { MigrationInterface, QueryRunner } from 'typeorm';

export class DealerScopedLeadIdentity1710000006000 implements MigrationInterface {
  name = 'DealerScopedLeadIdentity1710000006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // A phone can legitimately appear in more than one dealer relationship.
    // Duplicate prevention is enforced by the dealer-scoped service lookup.
    await queryRunner.query(`DROP INDEX IF EXISTS leads_canonical_phone_unique_idx`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS leads_canonical_phone_idx ON leads (canonical_phone)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS leads_canonical_phone_idx`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS leads_canonical_phone_unique_idx ON leads (canonical_phone) WHERE canonical_phone IS NOT NULL`);
  }
}
