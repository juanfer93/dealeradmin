import { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep geographic classification in the local locations catalog, not in code. */
export class EasternsLocationRoutingRules1710000021000 implements MigrationInterface {
  name = 'EasternsLocationRoutingRules1710000021000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS easterns_routing_zone VARCHAR(80)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS locations_easterns_routing_zone_idx ON locations (easterns_routing_zone)`);
    await queryRunner.query(`
      UPDATE locations
      SET easterns_routing_zone = CASE
        WHEN state_code IN ('DE', 'PA', 'NY', 'NJ') THEN 'outside_md_va'
        WHEN state_code IN ('VA', 'DC') THEN 'virginia'
        WHEN state_code = 'MD' AND normalized_name = 'baltimore' THEN 'baltimore_overlap'
        WHEN state_code = 'MD' AND normalized_name = 'silver spring' THEN 'silver_spring_laurel'
        WHEN state_code = 'MD' AND latitude < 39.0000000 THEN 'southern_md_overlap'
        WHEN state_code = 'MD' THEN 'maryland_laurel'
        ELSE NULL
      END
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS locations_easterns_routing_zone_idx`);
    await queryRunner.query(`ALTER TABLE locations DROP COLUMN IF EXISTS easterns_routing_zone`);
  }
}
