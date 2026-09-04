import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bind the four live collector locations to their source dealer/group.
 * Easterns still resolves its destination with GeoroutingService; the Laurel
 * row is only the source anchor used to identify the Easterns account.
 */
export class GhlLocationRouting1710000007000 implements MigrationInterface {
  name = 'GhlLocationRouting1710000007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        stafford_id UUID;
        easterns_source_id UUID;
      BEGIN
        SELECT id INTO stafford_id
        FROM dealers
        WHERE code = 'STAFFORD' OR LOWER(name) = 'offlease motors stafford'
        ORDER BY created_at, id
        LIMIT 1;

        IF stafford_id IS NULL THEN
          INSERT INTO dealers (code, name, ghl_location_id, timezone, active, routing_config)
          VALUES ('STAFFORD', 'Offlease Motors Stafford', 'LiaoSID3nvAhad49ZpNJ', 'America/New_York', true, '{}'::jsonb)
          RETURNING id INTO stafford_id;
        END IF;

        INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
        VALUES ('LiaoSID3nvAhad49ZpNJ', stafford_id)
        ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id;

        SELECT id INTO easterns_source_id
        FROM dealers
        WHERE code = 'DLR-EAST-LAUR' OR LOWER(name) = 'easterns laurel'
        ORDER BY created_at, id
        LIMIT 1;

        IF easterns_source_id IS NULL THEN
          RAISE EXCEPTION 'Easterns source dealer is not configured';
        END IF;

        INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
        VALUES ('xN2LSSl62okzv9GnOJPU', easterns_source_id)
        ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dealer_location_aliases
      WHERE ghl_location_id IN ('LiaoSID3nvAhad49ZpNJ', 'xN2LSSl62okzv9GnOJPU')
    `);
  }
}
