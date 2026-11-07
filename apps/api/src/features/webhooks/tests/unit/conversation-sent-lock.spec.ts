import { describe, expect, it, vi } from 'vitest';
import { ConversationEventFunctions } from '../../application/functions/conversations/conversation-event.functions';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversations/conversation-webhook.config';

describe('sent identity lock', () => {
  it('persists a later inbound message without re-normalizing a sent contact', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-sent-lock' }];
      if (sql.includes('lead_deletion_suppressions')) return [];
      if (sql.includes('INSERT INTO conversation_messages')) return [{ id: 'message-sent-lock' }];
      return [];
    });
    const runner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query,
    };
    const qualification = {
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', name: 'Stafford', timezone: 'America/New_York', routing_config: {} }),
      upsertLead: vi.fn().mockResolvedValue({ id: 'lead-sent', canonical_phone: '+13015550123', first_name: 'Correct', last_name: 'Name' }),
      upsertConversation: vi.fn().mockResolvedValue({
        id: 'conversation-sent',
        status: 'queued',
        qualification_snapshot: { real_name: 'Correct Name' },
        location_snapshot: {},
      }),
      isLeadSent: vi.fn().mockResolvedValue(true),
    };
    const eventFunctions = new ConversationEventFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      {} as never,
      GHL_SOURCE_CONFIG,
    );

    const result = await eventFunctions.persistEvent({
      event_id: 'evt-sent-lock',
      event_type: 'customer.replied',
      ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-sent',
      ghl_conversation_id: 'conversation-sent-ghl',
      channel: 'whatsapp',
      contact_name: 'Wrong New Reply',
      contact_phone: '+13015550123',
      message_body: 'I am still interested',
      occurred_at: '2026-11-06T18:00:00.000Z',
      raw_payload: {},
    }, 'stafford', '{}');

    expect(result).toMatchObject({ accepted: true, status: 'sent_locked' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE leads'))).toBe(false);
    expect(query.mock.calls.some((call) => {
      const [sql, params] = call as unknown as [unknown, unknown];
      return String(sql).includes("SET status = 'processed'") && Array.isArray(params) && params.includes('SENT_LOCKED');
    })).toBe(true);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('updates only the identity when a sent WhatsApp contact declares a name', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-sent-name' }];
      if (sql.includes('lead_deletion_suppressions')) return [];
      if (sql.includes('INSERT INTO conversation_messages')) return [{ id: 'message-sent-name' }];
      return [];
    });
    const runner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query,
    };
    const qualification = {
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', name: 'Stafford', timezone: 'America/New_York', routing_config: {} }),
      upsertLead: vi.fn().mockResolvedValue({ id: 'lead-sent-name', canonical_phone: '+13015550123', first_name: 'Alejandro', last_name: '' }),
      upsertConversation: vi.fn().mockResolvedValue({
        id: 'conversation-sent-name',
        status: 'queued',
        qualification_snapshot: { real_name: 'Alejandro', qualification_progress: { predicted_bot_question: '¿Cuál es tu nombre completo?' } },
        location_snapshot: {},
      }),
      isLeadSent: vi.fn().mockResolvedValue(true),
    };
    const eventFunctions = new ConversationEventFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      {} as never,
      GHL_SOURCE_CONFIG,
    );

    const result = await eventFunctions.persistEvent({
      event_id: 'evt-sent-name',
      event_type: 'customer.replied',
      ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-sent-name',
      ghl_conversation_id: 'conversation-sent-name-ghl',
      channel: 'whatsapp',
      contact_name: 'Alejandro',
      contact_phone: '+13015550123',
      message_body: 'Hola, mi nombre es Edwin',
      occurred_at: '2026-11-07T14:00:00.000Z',
      raw_payload: {},
    }, 'stafford', '{}');

    expect(result).toMatchObject({ accepted: true, status: 'sent_locked' });
    const conversationUpdate = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE conversations') && String(sql).includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[1]))).toMatchObject({ real_name: 'Edwin' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE leads SET first_name'))).toBe(true);
    expect(query.mock.calls.some((call) => {
      const [sql, params] = call as unknown as [unknown, unknown];
      return String(sql).includes('SENT_LOCKED_IDENTITY_UPDATED') || (Array.isArray(params) && params.includes('SENT_LOCKED_IDENTITY_UPDATED'));
    })).toBe(true);
  });
});
