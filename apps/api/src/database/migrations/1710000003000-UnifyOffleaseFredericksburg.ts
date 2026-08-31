import { MigrationInterface, QueryRunner } from 'typeorm';

export class UnifyOffleaseFredericksburg1710000003000 implements MigrationInterface {
  name = 'UnifyOffleaseFredericksburg1710000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dealer_location_aliases (
        ghl_location_id VARCHAR PRIMARY KEY,
        dealer_id UUID NOT NULL REFERENCES dealers(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        canonical_id UUID;
        duplicate_id UUID;
      BEGIN
        SELECT id INTO canonical_id
        FROM dealers
        WHERE ghl_location_id IN ('MyxWNKacThim798E8KC6', 'bAuMEQeH48xAtu9tAMFf')
           OR code IN ('FRED', 'FRED-2')
           OR LOWER(name) IN ('offlease fredericksburg', 'offlease fredericksburg 2')
        ORDER BY CASE
          WHEN ghl_location_id = 'MyxWNKacThim798E8KC6' THEN 0
          WHEN code = 'FRED' OR LOWER(name) = 'offlease fredericksburg' THEN 1
          ELSE 2
        END, created_at, id
        LIMIT 1;

        IF canonical_id IS NULL THEN
          INSERT INTO dealers (code, name, ghl_location_id, timezone, active, routing_config)
          VALUES ('FRED', 'Offlease Fredericksburg', 'MyxWNKacThim798E8KC6', 'America/New_York', true, '{}'::jsonb)
          RETURNING id INTO canonical_id;
        ELSE
          UPDATE dealers
          SET code = 'FRED',
              name = 'Offlease Fredericksburg',
              ghl_location_id = 'MyxWNKacThim798E8KC6',
              active = true,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = canonical_id;
        END IF;

        SELECT id INTO duplicate_id
        FROM dealers
        WHERE id <> canonical_id
          AND (ghl_location_id = 'bAuMEQeH48xAtu9tAMFf' OR code = 'FRED-2' OR LOWER(name) = 'offlease fredericksburg 2')
        ORDER BY created_at, id
        LIMIT 1;

        IF duplicate_id IS NOT NULL THEN
          UPDATE lead_dealers
          SET assigned_dealer_id = canonical_id,
              updated_at = CURRENT_TIMESTAMP
          WHERE assigned_dealer_id = duplicate_id;

          INSERT INTO lead_dealers (
            lead_id, dealer_id, vehicle_type, down_payment, identification, bank_account,
            purchase_timeline, documents, easterns_zone, routing_status, assigned_dealer_id,
            routing_override, routing_reason, status, message_text, sent_at, created_at, updated_at
          )
          SELECT
            lead_id, canonical_id, vehicle_type, down_payment, identification, bank_account,
            purchase_timeline, documents, easterns_zone, routing_status,
            CASE WHEN assigned_dealer_id = duplicate_id THEN canonical_id ELSE assigned_dealer_id END,
            routing_override, routing_reason, status, message_text, sent_at, created_at, CURRENT_TIMESTAMP
          FROM lead_dealers
          WHERE dealer_id = duplicate_id
          ON CONFLICT (lead_id, dealer_id) DO UPDATE SET
            vehicle_type = COALESCE(NULLIF(lead_dealers.vehicle_type, ''), EXCLUDED.vehicle_type),
            down_payment = COALESCE(NULLIF(lead_dealers.down_payment, ''), EXCLUDED.down_payment),
            identification = COALESCE(NULLIF(lead_dealers.identification, ''), EXCLUDED.identification),
            bank_account = COALESCE(NULLIF(lead_dealers.bank_account, ''), EXCLUDED.bank_account),
            purchase_timeline = COALESCE(NULLIF(lead_dealers.purchase_timeline, ''), EXCLUDED.purchase_timeline),
            documents = COALESCE(NULLIF(lead_dealers.documents, ''), EXCLUDED.documents),
            easterns_zone = COALESCE(NULLIF(lead_dealers.easterns_zone, ''), EXCLUDED.easterns_zone),
            assigned_dealer_id = COALESCE(lead_dealers.assigned_dealer_id, EXCLUDED.assigned_dealer_id),
            routing_override = lead_dealers.routing_override OR EXCLUDED.routing_override,
            routing_reason = COALESCE(NULLIF(lead_dealers.routing_reason, ''), EXCLUDED.routing_reason),
            routing_status = CASE WHEN lead_dealers.status = 'sent' THEN lead_dealers.routing_status ELSE EXCLUDED.routing_status END,
            status = CASE WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE EXCLUDED.status END,
            message_text = COALESCE(NULLIF(lead_dealers.message_text, ''), EXCLUDED.message_text),
            sent_at = COALESCE(lead_dealers.sent_at, EXCLUDED.sent_at),
            updated_at = CURRENT_TIMESTAMP;

          DELETE FROM lead_dealers WHERE dealer_id = duplicate_id;

          UPDATE dealers
          SET active = false,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = duplicate_id;
        END IF;

        INSERT INTO dealer_location_aliases (ghl_location_id, dealer_id)
        VALUES
          ('MyxWNKacThim798E8KC6', canonical_id),
          ('bAuMEQeH48xAtu9tAMFf', canonical_id)
        ON CONFLICT (ghl_location_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS dealer_location_aliases`);
  }
}
