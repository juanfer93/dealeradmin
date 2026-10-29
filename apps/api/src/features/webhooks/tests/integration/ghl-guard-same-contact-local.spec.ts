import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GhlGuardService } from '../../application/ghl-guard.service';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversations/conversation-webhook.config';
import { ConversationReconciliationFunctions } from '../../application/functions/conversations/conversation-reconciliation.functions';

const databaseUrl = process.env.GHL_GUARD_LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('GHL Guard same-contact local API reproduction', () => {
  const contactId = 'xYu6HDxH3hiERS3etLJw';
  const phone = '+17577019069';
  const locationId = GHL_SOURCE_CONFIG.stafford.locationId;
  const nativeConversationId = 'ghl-local-xYu6HDxH3hiERS3etLJw';
  const transcript = [
    '*Headline:* Off Lease Motors Of Stafford\n*Source URL:* https://fb.me/7zLyw0eht\n\n¡Hola! Quiero más información',
    'Cómo puedo ver los autos',
    'Okey',
    'Melquin Morales',
    'Un camaro',
    'O un Honda',
    '1500',
    'Cualquiera solo quisiera verlos',
  ].map((body, index) => ({
    id: `local-xYu-message-${index + 1}`,
    body,
    direction: 'inbound',
    dateAdded: new Date(Date.UTC(2026, 9, 29, 14, 40 + index)).toISOString(),
  }));

  let dataSource: DataSource;
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_BATCH_SIZE = '1';
    process.env.GHL_GUARD_CONCURRENCY = '1';
    process.env.GHL_GUARD_TIMEOUT_MS = '500';
    process.env.GHL_GUARD_CONVERSATION_TIMEOUT_MS = '3000';
    process.env.GHL_GUARD_RETRY_DELAY_MS = '600000';
    process.env.GHL_GUARD_CIRCUIT_FAILURE_THRESHOLD = '999999';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'local-test-token';

    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM ghl_guard_logs WHERE ghl_contact_id = $1', [contactId]);
    await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [contactId]);
    await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
    await dataSource.destroy();
  });

  it('retries the same contact after a GHL body timeout without creating a stale cycle', async () => {
    const [{ id: leadId }] = await dataSource.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, 'Okey', '', $2, $3, 'local reproduction')
       RETURNING id`,
      [phone, contactId, locationId],
    ) as Array<{ id: string }>;
    const [{ id: conversationId }] = await dataSource.query(
      `INSERT INTO conversations
         (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status, qualification_snapshot, next_attempt_at)
       VALUES ($1, $2, $3, $4, 'whatsapp', 'waiting_window', $5::jsonb, CURRENT_TIMESTAMP - INTERVAL '1 second')
       RETURNING id`,
      [leadId, locationId, contactId, `contact:${contactId}:whatsapp`, JSON.stringify({ real_name: 'Okey', phone })],
    ) as Array<{ id: string }>;

    const reconciliation = new ConversationReconciliationFunctions(
      dataSource,
      {
        resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
        findSourceDealer: vi.fn().mockResolvedValue({ id: 'local-stafford-dealer', timezone: 'America/New_York', routing_config: {} }),
        statusForConversation: vi.fn().mockReturnValue({ status: 'queued', nextAttemptAt: null }),
        syncLeadDealer: vi.fn().mockResolvedValue(undefined),
      } as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );
    const client = {
      searchConversationByContact: vi.fn().mockResolvedValue({
        ok: true, status: 200, requestPath: '/conversations/search',
        data: { conversation: { id: nativeConversationId }, total: 1 },
      }),
      listMessages: vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: `/conversations/${nativeConversationId}/messages`, attemptCount: 1, elapsedMs: 500 })
        .mockResolvedValue({
          ok: true, status: 200, requestPath: `/conversations/${nativeConversationId}/messages`, attemptCount: 1, elapsedMs: 4,
          data: { messages: transcript, pages: 1, truncated: false, responsePayload: [{ messages: transcript }] },
        }),
    };
    const service = new GhlGuardService(dataSource, reconciliation, GHL_SOURCE_CONFIG, client);

    const timedOut = await service.run(new Date(), { contactIds: [contactId], force: true });
    expect(timedOut).toMatchObject({ selected: 1, fetched: 0, failed: 1 });

    const failedLog = await dataSource.query(
      `SELECT status, error_code, request_attempt_count, request_timeout_ms, next_retry_at, lease_expires_at
       FROM ghl_guard_logs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    ) as Array<Record<string, unknown>>;
    expect(failedLog[0]).toMatchObject({
      status: 'failed',
      error_code: 'GHL_TIMEOUT',
      request_attempt_count: 1,
      request_timeout_ms: 500,
      lease_expires_at: null,
    });
    expect(failedLog[0]?.next_retry_at).toBeTruthy();

    const recovered = await service.run(new Date(), { contactIds: [contactId], force: true });
    expect(recovered, JSON.stringify(recovered)).toMatchObject({ selected: 1, fetched: transcript.length, failed: 0 });

    const persisted = await dataSource.query(
      `SELECT c.ghl_conversation_id, c.status, c.qualification_snapshot,
              l.canonical_phone, l.first_name, l.last_name,
              COUNT(cm.id)::int AS message_count
       FROM conversations c
       JOIN leads l ON l.id = c.lead_id
       LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
       WHERE c.id = $1
       GROUP BY c.id, l.canonical_phone, l.first_name, l.last_name`,
      [conversationId],
    ) as Array<{ ghl_conversation_id: string; status: string; qualification_snapshot: { real_name?: string }; canonical_phone: string; first_name: string; last_name: string; message_count: number }>;
    expect(persisted[0]).toMatchObject({
      ghl_conversation_id: nativeConversationId,
      status: 'waiting_window',
      qualification_snapshot: { real_name: 'Melquin Morales' },
      canonical_phone: phone,
      first_name: 'Melquin',
      last_name: 'Morales',
      message_count: transcript.length,
    });

    await dataSource.query(
      `UPDATE conversations SET waiting_window_attempts = 5, next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1`,
      [conversationId],
    );
    const terminalCycle = await service.run(new Date(), { contactIds: [contactId], force: true });
    expect(terminalCycle).toMatchObject({ selected: 1, fetched: transcript.length, failed: 0 });
    const terminalStatus = await dataSource.query(
      `SELECT status FROM conversations WHERE id = $1`,
      [conversationId],
    ) as Array<{ status: string }>;
    expect(terminalStatus[0]).toEqual({ status: 'queued' });

    const logs = await dataSource.query(
      `SELECT status, error_code FROM ghl_guard_logs WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId],
    ) as Array<{ status: string; error_code: string | null }>;
    expect(logs).toEqual([
      { status: 'failed', error_code: 'GHL_TIMEOUT' },
      { status: 'succeeded', error_code: null },
      { status: 'succeeded', error_code: null },
    ]);
    expect(logs.some((log) => log.error_code === 'GHL_GUARD_STALE_RUN')).toBe(false);
  }, 10_000);
});
