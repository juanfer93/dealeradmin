import type { DataSource } from 'typeorm';

const FIXTURE_CONTACT_IDS = [
  'e2e-ui-maria',
  'e2e-ui-carlos',
  'e2e-ui-andres',
  'e2e-webhook-contact',
  'e2e-language-1',
  'e2e-language-2',
  'e2e-language-3',
  'e2e-language-4',
  'e2e-language-5',
  'e2e-language-6',
];
const FIXTURE_PHONES = [
  '+15559876543',
  '+15551234567',
  '+15550001111',
  '+15551234568',
  '+18045550101',
  '+18045550102',
  '+18045550103',
  '+18045550104',
  '+18045550105',
  '+18045550106',
];
const FIXTURE_SOURCES = ['E2E Manual Console', 'E2E Bulk Console', 'Manual Console', 'Manual Bulk Console'];

/**
 * Rebuilds only the deterministic data used by browser tests running against
 * PostgreSQL. Production and non-database test modes never call this helper.
 */
export async function resetDatabaseTestFixtures(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    const fixtureLeads = `
      SELECT id
      FROM leads
      WHERE ghl_contact_id = ANY($1::text[])
         OR canonical_phone = ANY($2::text[])
         OR source = ANY($3::text[])
    `;

    await manager.query(
      `DELETE FROM conversation_bot_pause_events WHERE lead_id IN (${fixtureLeads})`,
      [FIXTURE_CONTACT_IDS, FIXTURE_PHONES, FIXTURE_SOURCES],
    );
    await manager.query(
      `DELETE FROM conversation_messages
       WHERE conversation_id IN (SELECT id FROM conversations WHERE lead_id IN (${fixtureLeads}))`,
      [FIXTURE_CONTACT_IDS, FIXTURE_PHONES, FIXTURE_SOURCES],
    );
    await manager.query(
      `DELETE FROM conversations WHERE lead_id IN (${fixtureLeads})`,
      [FIXTURE_CONTACT_IDS, FIXTURE_PHONES, FIXTURE_SOURCES],
    );
    await manager.query(
      `DELETE FROM lead_ingestion_rows WHERE lead_id IN (${fixtureLeads})`,
      [FIXTURE_CONTACT_IDS, FIXTURE_PHONES, FIXTURE_SOURCES],
    );
    await manager.query(
      `DELETE FROM lead_dealers WHERE lead_id IN (${fixtureLeads})`,
      [FIXTURE_CONTACT_IDS, FIXTURE_PHONES, FIXTURE_SOURCES],
    );
    await manager.query(
      `DELETE FROM leads WHERE id IN (${fixtureLeads})`,
      [FIXTURE_CONTACT_IDS, FIXTURE_PHONES, FIXTURE_SOURCES],
    );
    await manager.query(`DELETE FROM webhook_events WHERE event_id LIKE 'evt-e2e-%'`);

    await manager.query(
      `INSERT INTO leads
        (id, canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source, created_at, updated_at)
       SELECT seed.id, seed.canonical_phone, seed.first_name, seed.last_name, seed.ghl_contact_id,
              d.ghl_location_id, 'E2E UI Fixture', seed.created_at, CURRENT_TIMESTAMP
       FROM (VALUES
         ('00000000-0000-0000-0000-000000000101'::uuid, '+15559876543', 'Maria', 'Lopez', 'e2e-ui-maria', 'DLR-FRED-001', '2026-08-21T12:00:00Z'::timestamptz),
         ('00000000-0000-0000-0000-000000000102'::uuid, '+15551234567', 'Carlos', 'Mendoza', 'e2e-ui-carlos', 'DLR-STAFF-001', '2026-08-21T12:05:00Z'::timestamptz),
         ('00000000-0000-0000-0000-000000000103'::uuid, '+15550001111', 'Andres', 'Felipe', 'e2e-ui-andres', 'DLR-EAST-LAUR', '2026-08-24T15:00:00Z'::timestamptz)
       ) AS seed(id, canonical_phone, first_name, last_name, ghl_contact_id, dealer_code, created_at)
       INNER JOIN dealers d ON d.code = seed.dealer_code`,
    );

    await manager.query(
      `INSERT INTO lead_dealers
        (lead_id, dealer_id, vehicle_type, down_payment, purchase_timeline, documents,
         identification, bank_account, assigned_dealer_id, routing_override, routing_reason,
         routing_status, status, message_text, has_unhandled_reengagement, created_at, updated_at)
       SELECT seed.lead_id, d.id, seed.vehicle_type, seed.down_payment, '', '', '', '', d.id, false,
              'E2E UI fixture', 'resolved', 'pending', seed.message_text, false,
              seed.created_at, CURRENT_TIMESTAMP
       FROM (VALUES
         ('00000000-0000-0000-0000-000000000101'::uuid, 'DLR-FRED-001', 'Sedan', '', 'Maria Lopez +15559876543 Sedan.', '2026-08-21T12:00:00Z'::timestamptz),
         ('00000000-0000-0000-0000-000000000102'::uuid, 'DLR-STAFF-001', 'Sedan', '', 'Carlos Mendoza +15551234567 Sedan.', '2026-08-21T12:05:00Z'::timestamptz),
         ('00000000-0000-0000-0000-000000000103'::uuid, 'DLR-EAST-LAUR', 'SUV', 'Pagara en cash / de contado', 'Andres Felipe +15550001111 SUV, Pagara en cash / de contado.', '2026-08-24T15:00:00Z'::timestamptz)
       ) AS seed(lead_id, dealer_code, vehicle_type, down_payment, message_text, created_at)
       INNER JOIN dealers d ON d.code = seed.dealer_code`,
    );
  });
}
