import { MigrationInterface, QueryRunner } from 'typeorm';

export class Day5EasternsRouting1710000002000 implements MigrationInterface {
  name = 'Day5EasternsRouting1710000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE lead_dealers ADD COLUMN IF NOT EXISTS routing_reason TEXT`);

    await queryRunner.query(`
      INSERT INTO dealers (id, code, name, ghl_location_id, timezone, active, routing_config)
      VALUES
        ('d1111111-1111-1111-1111-111111111111', 'DLR-EAST-ROSE', 'Easterns Rosedale', 'loc_rosedale_999', 'America/Bogota', true, '{"group":"Easterns"}'::jsonb),
        ('d2222222-2222-2222-2222-222222222222', 'DLR-EAST-LAUR', 'Easterns Laurel', 'loc_laurel_888', 'America/Bogota', true, '{"group":"Easterns"}'::jsonb),
        ('d3333333-3333-3333-3333-333333333333', 'DLR-EAST-STER', 'Easterns Sterling', 'loc_sterling_777', 'America/Bogota', true, '{"group":"Easterns"}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code,
        name = EXCLUDED.name,
        ghl_location_id = EXCLUDED.ghl_location_id,
        timezone = EXCLUDED.timezone,
        active = EXCLUDED.active,
        routing_config = EXCLUDED.routing_config,
        updated_at = CURRENT_TIMESTAMP
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM dealers WHERE id IN (
      'd1111111-1111-1111-1111-111111111111',
      'd2222222-2222-2222-2222-222222222222',
      'd3333333-3333-3333-3333-333333333333'
    )`);
    await queryRunner.query(`ALTER TABLE lead_dealers DROP COLUMN IF EXISTS routing_reason`);
  }
}
