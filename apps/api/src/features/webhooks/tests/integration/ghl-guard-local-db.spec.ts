import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversations/conversation-webhook.config';
import { GhlGuardService } from '../../application/ghl-guard.service';

const databaseUrl = process.env.GHL_GUARD_LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('GHL Guard retry and split recovery against local PostgreSQL', () => {
  let dataSource: DataSource;
  const suffix = `ghl-guard-local-${Date.now()}`;
  const locationId = GHL_SOURCE_CONFIG.stafford.locationId;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('GHL_GUARD_LOCAL_DATABASE_URL or DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('reclaims an expired global lease after the previous invocation disappears', async () => {
    const leaseKey = `${suffix}-global-lease`;
    const firstOwner = `${suffix}-owner-a`;
    const secondOwner = `${suffix}-owner-b`;
    const acquire = async (ownerId: string) => dataSource.query(
      `INSERT INTO ghl_guard_leases
         (lease_key, owner_id, acquired_at, lease_expires_at, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP + ($3::integer * INTERVAL '1 millisecond'),
               CURRENT_TIMESTAMP)
       ON CONFLICT (lease_key) DO UPDATE
         SET owner_id = EXCLUDED.owner_id,
             acquired_at = EXCLUDED.acquired_at,
             lease_expires_at = EXCLUDED.lease_expires_at,
             updated_at = EXCLUDED.updated_at
       WHERE ghl_guard_leases.lease_expires_at <= CURRENT_TIMESTAMP
       RETURNING owner_id`,
      [leaseKey, ownerId, 60_000],
    ) as Promise<Array<{ owner_id: string }>>;

    try {
      const firstClaim = await acquire(firstOwner);
      expect(firstClaim).toEqual([{ owner_id: firstOwner }]);

      const blockedClaim = await acquire(secondOwner);
      expect(blockedClaim).toEqual([]);

      await dataSource.query(
        `UPDATE ghl_guard_leases SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE lease_key = $1`,
        [leaseKey],
      );

      const reclaimedClaim = await acquire(secondOwner);
      expect(reclaimedClaim).toEqual([{ owner_id: secondOwner }]);
    } finally {
      await dataSource.query('DELETE FROM ghl_guard_leases WHERE lease_key = $1', [leaseKey]);
    }
  }, 10_000);

  it('prioritizes a due timeout, bypasses search for a local sibling, and unifies the split', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_BATCH_SIZE = '1';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'local-test-token';

    const primaryContactId = `${suffix}-split-contact`;
    const freshContactId = `${suffix}-fresh-contact`;
      const syntheticGhlConversationId = `contact:${primaryContactId}:messenger`;
    const conversationIds: string[] = [];
    const contacts = [primaryContactId, freshContactId];

    try {
      const leadRows = await dataSource.query(
        `INSERT INTO leads (first_name, last_name, ghl_contact_id, ghl_location_id, source)
         VALUES ('Local', 'Split', $1, $2, 'local-test'), ('Local', 'Fresh', $3, $2, 'local-test')
         RETURNING id, ghl_contact_id`,
        [primaryContactId, locationId, freshContactId],
      ) as Array<{ id: string; ghl_contact_id: string }>;
      const primaryLead = leadRows.find((row) => row.ghl_contact_id === primaryContactId)!;
      const freshLead = leadRows.find((row) => row.ghl_contact_id === freshContactId)!;

      const conversationRows = await dataSource.query(
        `INSERT INTO conversations
           (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status, last_message_at)
         VALUES
           ($1, $2, $3, $4, 'messenger', 'partial', CURRENT_TIMESTAMP),
           ($1, $2, $3, $5, 'messenger', 'partial', CURRENT_TIMESTAMP),
           ($6, $2, $7, $8, 'messenger', 'partial', CURRENT_TIMESTAMP)
         RETURNING id, ghl_contact_id, ghl_conversation_id`,
        [
          primaryLead.id, locationId, primaryContactId, `${suffix}-native`, syntheticGhlConversationId,
          freshLead.id, freshContactId, `${suffix}-fresh`,
        ],
      ) as Array<{ id: string; ghl_contact_id: string; ghl_conversation_id: string }>;
      conversationIds.push(...conversationRows.map((row) => row.id));

      const synthetic = conversationRows.find((row) => row.ghl_conversation_id === syntheticGhlConversationId)!;
      const canonical = conversationRows.find((row) => row.ghl_conversation_id === `${suffix}-native`)!;

      await dataSource.query(
        `INSERT INTO conversation_messages
           (conversation_id, dedupe_key, ghl_message_id, direction, body, occurred_at, raw_payload)
         VALUES ($1, $2, $3, 'inbound', 'mensaje local dividido', CURRENT_TIMESTAMP, '{}'::jsonb)`,
        [synthetic.id, `${suffix}-local-message`, `${suffix}-local-message`],
      );
      await dataSource.query(
        `INSERT INTO ghl_guard_logs
           (run_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, conversation_id, status, error_code, next_retry_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'failed', 'GHL_TIMEOUT', CURRENT_TIMESTAMP - INTERVAL '1 hour')`,
        [locationId, primaryContactId, syntheticGhlConversationId, synthetic.id],
      );

      const listMessages = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        requestPath: `/conversations/${canonical.ghl_conversation_id}/messages`,
        data: {
          messages: [{
            id: `${suffix}-ghl-message`,
            body: 'mensaje recuperado desde GHL',
            direction: 'inbound',
            dateAdded: new Date().toISOString(),
          }],
          pages: 1,
          truncated: false,
          responsePayload: [],
        },
      });
      const searchConversationByContact = vi.fn();
      const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
      const service = new GhlGuardService(
        dataSource,
        reconciliation as never,
        GHL_SOURCE_CONFIG,
        { listMessages, searchConversationByContact },
      );

      const result = await service.run(new Date(), { force: true });

      expect(result).toMatchObject({ selected: 1, fetched: 1, failed: 0 });
      expect(searchConversationByContact).not.toHaveBeenCalled();
      expect(listMessages).toHaveBeenCalledOnce();

      const finalRows = await dataSource.query(
        `SELECT c.ghl_conversation_id, c.status, COUNT(cm.id)::int AS messages
         FROM conversations c
         LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
         WHERE c.ghl_contact_id = $1
         GROUP BY c.id, c.ghl_conversation_id, c.status
         ORDER BY c.ghl_conversation_id`,
        [primaryContactId],
      ) as Array<{ ghl_conversation_id: string; status: string; messages: number }>;
      expect(finalRows).toEqual([
        { ghl_conversation_id: syntheticGhlConversationId, status: 'duplicate_ignored', messages: 0 },
        { ghl_conversation_id: `${suffix}-native`, status: 'partial', messages: 2 },
      ]);

      const guardRows = await dataSource.query(
        `SELECT status, error_code, reconciled, inserted_message_count, repaired_message_count
         FROM ghl_guard_logs
         WHERE conversation_id = $1
         ORDER BY created_at DESC`,
        [synthetic.id],
      ) as Array<{ status: string; error_code: string | null; reconciled: boolean; inserted_message_count: number; repaired_message_count: number }>;
      expect(guardRows[0]).toMatchObject({ status: 'succeeded', error_code: null, reconciled: true });
    } finally {
      await dataSource.query('DELETE FROM ghl_guard_logs WHERE ghl_contact_id = ANY($1::text[])', [contacts]);
      if (conversationIds.length > 0) await dataSource.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [conversationIds]);
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = ANY($1::text[])', [contacts]);
    }
  }, 30_000);
});
