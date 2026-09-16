import { describe, expect, it, vi } from 'vitest';
import {
  ConversationWebhookService,
  GHL_SOURCE_CONFIG,
} from '../../application/conversation-webhook.service';
import {
  GhlQueuedPauseNotifier,
  isQueuedTransition,
  QUEUED_PAUSE_HOURS,
  QueuedPauseDeliveryError,
  type QueuedPausePayload,
} from '../../application/conversation-bot-pause';

describe('queued Conversation AI pause', () => {
  it.each([
    ['partial', 'queued', true],
    ['waiting_window', 'queued', true],
    ['ready', 'queued', true],
    ['queued', 'queued', false],
    ['partial', 'waiting_window', false],
    ['partial', 'ready', false],
  ])('emits only for a non-queued to queued transition: %s -> %s', (previous, next, expected) => {
    expect(isQueuedTransition(previous, next)).toBe(expected);
  });

  it('creates one complete, canonical-location outbox payload for a transition', async () => {
    const queries: Array<[string, unknown[] | undefined]> = [];
    const runner = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push([sql, params]);
        if (sql.includes('MAX(transition_number)')) return [{ transition_number: 1 }];
        return [];
      }),
    };
    const service = new ConversationWebhookService();
    const created = await (service as unknown as {
      createQueuedPauseEvent: (...args: unknown[]) => Promise<{ source: string; payload: QueuedPausePayload } | null>;
    }).createQueuedPauseEvent(runner, 'waiting_window', 'queued', {
      conversationId: 'db-conversation-1',
      ghlConversationId: 'ghl-conversation-1',
      contactId: 'ghl-contact-1',
      locationId: GHL_SOURCE_CONFIG.easterns.locationId,
      leadId: 'lead-1',
      source: 'easterns',
      emittedAt: new Date('2026-09-16T15:00:00.000Z'),
    });

    expect(created).not.toBeNull();
    expect(created?.payload).toMatchObject({
      event: 'dealeradmin.conversation_queued',
      queued: true,
      status: 'queued',
      conversationId: 'ghl-conversation-1',
      contactId: 'ghl-contact-1',
      locationId: 'xN2LSSl62okzv9GnOJPU',
      leadId: 'lead-1',
      pauseHours: 24,
      emittedAt: '2026-09-16T15:00:00.000Z',
    });
    expect(created?.payload.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(queries.some(([sql]) => sql.includes('INSERT INTO conversation_bot_pause_events'))).toBe(true);
    const insert = queries.find(([sql]) => sql.includes('INSERT INTO conversation_bot_pause_events'));
    expect(insert?.[1]).toEqual(expect.arrayContaining([
      created?.payload.eventId,
      'db-conversation-1',
      1,
      'ghl-conversation-1',
      'ghl-contact-1',
      GHL_SOURCE_CONFIG.easterns.locationId,
      'lead-1',
      true,
      24,
      '2026-09-16T15:00:00.000Z',
      '2026-09-17T15:00:00.000Z',
    ]));
    expect(JSON.stringify(created?.payload)).not.toMatch(/secret|token|password/i);
  });

  it('does not create an outbox event when queued receives another message', async () => {
    const runner = { query: vi.fn() };
    const service = new ConversationWebhookService();
    const result = await (service as unknown as {
      createQueuedPauseEvent: (...args: unknown[]) => Promise<unknown>;
    }).createQueuedPauseEvent(runner, 'queued', 'queued', {
      conversationId: 'db-conversation-1',
      ghlConversationId: 'ghl-conversation-1',
      contactId: 'ghl-contact-1',
      locationId: GHL_SOURCE_CONFIG.stafford.locationId,
      leadId: 'lead-1',
      source: 'stafford',
      emittedAt: new Date(),
    });

    expect(result).toBeNull();
    expect(runner.query).not.toHaveBeenCalled();
  });

  it('allocates a new eventId for a later queued re-entry', async () => {
    const inserted: unknown[][] = [];
    let sequence = 0;
    const runner = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('MAX(transition_number)')) return [{ transition_number: ++sequence }];
        if (sql.includes('INSERT INTO conversation_bot_pause_events')) inserted.push(params || []);
        return [];
      }),
    };
    const service = new ConversationWebhookService();
    const makeEvent = () => (service as unknown as {
      createQueuedPauseEvent: (...args: unknown[]) => Promise<{ payload: QueuedPausePayload } | null>;
    }).createQueuedPauseEvent(runner, 'waiting_window', 'queued', {
      conversationId: 'db-conversation-reentry',
      ghlConversationId: 'ghl-conversation-reentry',
      contactId: 'ghl-contact-reentry',
      locationId: GHL_SOURCE_CONFIG.stafford.locationId,
      leadId: 'lead-reentry',
      source: 'stafford',
      emittedAt: new Date('2026-09-16T15:00:00.000Z'),
    });
    const first = await makeEvent();
    const second = await makeEvent();

    expect(first?.payload.eventId).not.toBe(second?.payload.eventId);
    expect(inserted[0]?.[2]).toBe(1);
    expect(inserted[1]?.[2]).toBe(2);
  });

  it('keeps timeout/retry on the same eventId without creating another pause event', async () => {
    const eventId = 'same-transition-event-id';
    const payload: QueuedPausePayload = {
      event: 'dealeradmin.conversation_queued',
      eventId,
      queued: true,
      status: 'queued',
      conversationId: 'ghl-conversation-retry',
      contactId: 'ghl-contact-retry',
      locationId: GHL_SOURCE_CONFIG.stafford.locationId,
      leadId: 'lead-retry',
      pauseHours: 24,
      emittedAt: '2026-09-16T15:00:00.000Z',
    };
    let attempts = 0;
    const notifier = {
      send: vi.fn(async (_source: string, sentPayload: QueuedPausePayload) => {
        attempts += 1;
        expect(sentPayload.eventId).toBe(eventId);
        if (attempts === 1) throw new QueuedPauseDeliveryError('Queued pause webhook timed out after 5000ms');
        return { delivered: true };
      }),
    };
    const dataSource = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT event_id, ghl_conversation_id')) return [{
          event_id: eventId,
          ghl_conversation_id: payload.conversationId,
          ghl_contact_id: payload.contactId,
          ghl_location_id: payload.locationId,
          lead_id: payload.leadId,
          emitted_at: payload.emittedAt,
        }];
        return [];
      }),
    };
    const service = new ConversationWebhookService(dataSource as never, undefined, notifier);

    await expect(service.dispatchPendingQueuedPauseEvents()).resolves.toBe(1);
    await expect(service.dispatchPendingQueuedPauseEvents()).resolves.toBe(1);
    expect(notifier.send).toHaveBeenCalledTimes(2);
    expect(notifier.send.mock.calls[0][1].eventId).toBe(notifier.send.mock.calls[1][1].eventId);
    expect(dataSource.query.mock.calls.some(([sql]) => String(sql).includes("status = 'failed'"))).toBe(true);
    expect(dataSource.query.mock.calls.some(([sql]) => String(sql).includes("status = 'sent'"))).toBe(true);
  });

  it('simulates condition, individual conversation isolation, and the 24-hour window locally', () => {
    const targetKey = (locationId: string, contactId: string, conversationId: string) => `${locationId}:${contactId}:${conversationId}`;
    const bots = new Map([
      [targetKey(GHL_SOURCE_CONFIG.easterns.locationId, 'contact-a', 'conversation-a'), 'Active'],
      [targetKey(GHL_SOURCE_CONFIG.easterns.locationId, 'contact-b', 'conversation-b'), 'Active'],
      [targetKey(GHL_SOURCE_CONFIG.easterns.locationId, 'contact-a', 'conversation-b'), 'Active'],
      [targetKey(GHL_SOURCE_CONFIG.stafford.locationId, 'contact-a', 'conversation-a'), 'Active'],
    ]);
    const payload: QueuedPausePayload = {
      event: 'dealeradmin.conversation_queued',
      eventId: 'local-workflow-event',
      queued: true,
      status: 'queued',
      conversationId: 'conversation-a',
      contactId: 'contact-a',
      locationId: GHL_SOURCE_CONFIG.easterns.locationId,
      leadId: 'lead-a',
      pauseHours: 24,
      emittedAt: '2026-09-16T15:00:00.000Z',
    };
    const pauseUntil = new Date(payload.emittedAt).getTime() + payload.pauseHours * 60 * 60 * 1000;
    if (payload.queued === true && payload.status === 'queued') {
      const key = targetKey(payload.locationId, payload.contactId, payload.conversationId);
      bots.set(key, 'Inactive');
      expect(bots.get(key)).toBe('Inactive');
      expect(bots.get(targetKey(payload.locationId, 'contact-b', 'conversation-b'))).toBe('Active');
      expect(bots.get(targetKey(payload.locationId, 'contact-a', 'conversation-b'))).toBe('Active');
      expect(bots.get(targetKey(GHL_SOURCE_CONFIG.stafford.locationId, 'contact-a', 'conversation-a'))).toBe('Active');
      bots.set(key, 'Active');
    }
    expect(pauseUntil).toBe(new Date('2026-09-17T15:00:00.000Z').getTime());
    expect(JSON.stringify(payload)).not.toMatch(/https?:\/\/|token|password|secret/i);
  });

  it('does not call an external target when the source webhook is unconfigured', async () => {
    const previous = process.env.GHL_QUEUED_PAUSE_WEBHOOK_URL_STAFFORD;
    delete process.env.GHL_QUEUED_PAUSE_WEBHOOK_URL_STAFFORD;
    try {
      const notifier = new GhlQueuedPauseNotifier();
      const result = await notifier.send('stafford', {
        event: 'dealeradmin.conversation_queued',
        eventId: 'unconfigured-event',
        queued: true,
        status: 'queued',
        conversationId: 'conversation-unconfigured',
        contactId: 'contact-unconfigured',
        locationId: GHL_SOURCE_CONFIG.stafford.locationId,
        leadId: 'lead-unconfigured',
        pauseHours: QUEUED_PAUSE_HOURS,
        emittedAt: '2026-09-16T15:00:00.000Z',
      });
      expect(result).toEqual({ delivered: false, reason: 'webhook_not_configured' });
    } finally {
      if (previous === undefined) delete process.env.GHL_QUEUED_PAUSE_WEBHOOK_URL_STAFFORD;
      else process.env.GHL_QUEUED_PAUSE_WEBHOOK_URL_STAFFORD = previous;
    }
  });
});
