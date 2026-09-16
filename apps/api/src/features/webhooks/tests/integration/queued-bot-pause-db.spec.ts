import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConversationWebhookService,
  GHL_SOURCE_CONFIG,
} from '../../application/conversation-webhook.service';

const runDatabaseCase = process.env.RUN_QUEUED_PAUSE_DB === '1';
const describeDatabaseCase = runDatabaseCase ? describe : describe.skip;

describeDatabaseCase('queued Conversation AI pause with local PostgreSQL', () => {
  let dataSource: DataSource;
  let leadId: string;
  let conversationId: string;
  const locationId = GHL_SOURCE_CONFIG.easterns.locationId;
  const ghlConversationId = `local-queued-conversation-${randomUUID()}`;
  const ghlContactId = `local-queued-contact-${randomUUID()}`;
  const service = new ConversationWebhookService();

  beforeAll(async () => {
    const databaseUrl = process.env.QUEUED_PAUSE_TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl || !/(localhost|127\.0\.0\.1)/i.test(databaseUrl)) {
      throw new Error('RUN_QUEUED_PAUSE_DB requires a localhost PostgreSQL URL');
    }
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
    const leadRows = await dataSource.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, $2, $3, $4, $5, 'queued-pause-local-test') RETURNING id`,
      [`+1${String(Date.now()).slice(-10)}`, 'Queued', 'Pause Test', ghlContactId, locationId],
    ) as Array<{ id: string }>;
    leadId = leadRows[0].id;
    const conversationRows = await dataSource.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status)
       VALUES ($1, $2, $3, $4, 'messenger', 'partial') RETURNING id`,
      [leadId, locationId, ghlContactId, ghlConversationId],
    ) as Array<{ id: string }>;
    conversationId = conversationRows[0].id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    await dataSource.query('DELETE FROM leads WHERE id = $1', [leadId]);
    await dataSource.destroy();
  });

  it('persists one event, ignores a queued message, then creates one new event after re-entry', async () => {
    const emit = async (previousStatus: string, emittedAt: Date) => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`UPDATE conversations SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [conversationId]);
        const created = await (service as unknown as {
          createQueuedPauseEvent: (...args: unknown[]) => Promise<{ payload: { eventId: string } } | null>;
        }).createQueuedPauseEvent(runner, previousStatus, 'queued', {
          conversationId,
          ghlConversationId,
          contactId: ghlContactId,
          locationId,
          leadId,
          source: 'easterns',
          emittedAt,
        });
        await runner.commitTransaction();
        return created;
      } catch (error) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    };

    const first = await emit('partial', new Date('2026-09-16T15:00:00.000Z'));
    expect(first?.payload.eventId).toBeTruthy();
    expect(await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM conversation_bot_pause_events WHERE conversation_id = $1`,
      [conversationId],
    )).toEqual([{ count: 1 }]);

    const queuedMessage = await (service as unknown as {
      createQueuedPauseEvent: (...args: unknown[]) => Promise<unknown>;
    }).createQueuedPauseEvent(
      dataSource.createQueryRunner(), 'queued', 'queued', {
        conversationId,
        ghlConversationId,
        contactId: ghlContactId,
        locationId,
        leadId,
        source: 'easterns',
        emittedAt: new Date('2026-09-16T15:05:00.000Z'),
      },
    );
    expect(queuedMessage).toBeNull();

    await dataSource.query(`UPDATE conversations SET status = 'waiting_window' WHERE id = $1`, [conversationId]);
    const second = await emit('waiting_window', new Date('2026-09-17T15:00:00.000Z'));
    expect(second?.payload.eventId).toBeTruthy();
    expect(second?.payload.eventId).not.toBe(first?.payload.eventId);
    const rows = await dataSource.query(
      `SELECT transition_number, event_id, pause_until FROM conversation_bot_pause_events WHERE conversation_id = $1 ORDER BY transition_number`,
      [conversationId],
    ) as Array<{ transition_number: number; event_id: string; pause_until: Date }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.transition_number)).toEqual([1, 2]);
    expect(new Date(rows[0].pause_until).toISOString()).toBe('2026-09-17T15:00:00.000Z');
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(2);
  });
});
