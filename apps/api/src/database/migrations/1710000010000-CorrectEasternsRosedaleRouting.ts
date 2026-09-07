import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The live Easterns GHL account is Rosedale, but the original alias used
 * Laurel as its source anchor. That made leads without an explicit zone fall
 * into Laurel and also left already-ingested Rosedale leads in the wrong
 * queue. Keep explicit geographic overrides intact, correct only non-overridden
 * leads from that GHL location, and make the migration safe to re-run.
 */
export class CorrectEasternsRosedaleRouting1710000010000 implements MigrationInterface {
  name = 'CorrectEasternsRosedaleRouting1710000010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        rosedale_id UUID;
        laurel_id UUID;
      BEGIN
        SELECT id INTO rosedale_id
        FROM dealers
        WHERE code = 'DLR-EAST-ROSE' OR LOWER(name) = 'easterns rosedale'
        ORDER BY created_at, id
        LIMIT 1;

        SELECT id INTO laurel_id
        FROM dealers
        WHERE code = 'DLR-EAST-LAUR' OR LOWER(name) = 'easterns laurel'
        ORDER BY created_at, id
        LIMIT 1;

        IF rosedale_id IS NULL OR laurel_id IS NULL THEN
          RAISE EXCEPTION 'Easterns Rosedale/Laurel dealers are not configured';
        END IF;

        INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
        VALUES ('xN2LSSl62okzv9GnOJPU', rosedale_id)
        ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id;

        UPDATE lead_dealers wrong_queue
        SET dealer_id = rosedale_id,
            assigned_dealer_id = CASE
              WHEN wrong_queue.assigned_dealer_id = laurel_id THEN rosedale_id
              ELSE wrong_queue.assigned_dealer_id
            END,
            routing_reason = 'Source GHL Rosedale account (corrected from Laurel)',
            routing_status = 'resolved',
            updated_at = CURRENT_TIMESTAMP
        FROM leads source_lead
        WHERE source_lead.id = wrong_queue.lead_id
          AND source_lead.ghl_location_id = 'xN2LSSl62okzv9GnOJPU'
          AND wrong_queue.dealer_id = laurel_id
          AND wrong_queue.routing_override = false
          AND NOT EXISTS (
            SELECT 1
            FROM lead_dealers existing_rosedale
            WHERE existing_rosedale.lead_id = wrong_queue.lead_id
              AND existing_rosedale.dealer_id = rosedale_id
          );

        DELETE FROM lead_dealers wrong_queue
        USING leads source_lead
        WHERE source_lead.id = wrong_queue.lead_id
          AND source_lead.ghl_location_id = 'xN2LSSl62okzv9GnOJPU'
          AND wrong_queue.dealer_id = laurel_id
          AND wrong_queue.routing_override = false
          AND EXISTS (
            SELECT 1
            FROM lead_dealers existing_rosedale
            WHERE existing_rosedale.lead_id = wrong_queue.lead_id
              AND existing_rosedale.dealer_id = rosedale_id
          );
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        laurel_id UUID;
      BEGIN
        SELECT id INTO laurel_id
        FROM dealers
        WHERE code = 'DLR-EAST-LAUR' OR LOWER(name) = 'easterns laurel'
        ORDER BY created_at, id
        LIMIT 1;

        IF laurel_id IS NOT NULL THEN
          INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
          VALUES ('xN2LSSl62okzv9GnOJPU', laurel_id)
          ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id;
        END IF;
      END $$;
    `);
  }
}
