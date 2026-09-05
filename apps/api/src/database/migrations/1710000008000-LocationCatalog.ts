import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocationCatalog1710000008000 implements MigrationInterface {
  name = 'LocationCatalog1710000008000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        state_code CHAR(2) NOT NULL,
        state_name VARCHAR(80) NOT NULL,
        name VARCHAR(160) NOT NULL,
        normalized_name VARCHAR(160) NOT NULL,
        place_type VARCHAR(40) NOT NULL,
        latitude NUMERIC(10, 7) NOT NULL,
        longitude NUMERIC(10, 7) NOT NULL,
        source VARCHAR(120) NOT NULL DEFAULT 'US Census Gazetteer 2024',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT locations_state_name_type_coords_unique UNIQUE (state_code, normalized_name, place_type, latitude, longitude)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS locations_normalized_name_idx ON locations (normalized_name)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS locations_state_code_idx ON locations (state_code)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS locations');
  }
}
