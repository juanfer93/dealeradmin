import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';
import { getTestConversationEvents, resetTestConversationEvents } from '../../application/test-conversation-store';

describe('ConversationWebhookService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    resetTestConversationEvents();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('captures one inbound message using the native contact id header', async () => {
    const service = new ConversationWebhookService();
    const result = await service.acceptCustomerReplied(
      {
        message_body: 'I am looking for an SUV.',
        contact_phone: '+13015550123',
        contact_name: 'Ana Torres',
        channel: 'whatsapp',
      },
      'stafford',
      { contactId: 'ghl-contact-1', conversationId: 'ghl-conversation-1', messageId: 'ghl-message-1' },
      '{"message_body":"I am looking for an SUV."}',
    );

    expect(result).toMatchObject({ accepted: true, source: 'stafford', conversationId: 'ghl-conversation-1', status: 'processed' });
    expect(getTestConversationEvents()).toEqual([
      expect.objectContaining({ contactId: 'ghl-contact-1', conversationId: 'ghl-conversation-1', message: 'I am looking for an SUV.', channel: 'whatsapp' }),
    ]);
  });

  it('rejects a message when the native contact id is absent', async () => {
    const service = new ConversationWebhookService();
    await expect(service.acceptCustomerReplied({ message_body: 'SUV' }, 'stafford', {})).rejects.toThrow('Contact ID');
  });

  it('keeps the source mapping for Easterns independent of free-form dealer text', async () => {
    const service = new ConversationWebhookService();
    const result = await service.acceptCustomerReplied(
      { message_body: 'I live in Baltimore and need an SUV.', channel: 'messenger' },
      'easterns',
      { contactId: 'ghl-easterns-contact', conversationId: 'ghl-easterns-conversation' },
    );

    expect(result.source).toBe('easterns');
    expect(result.conversationId).toBe('ghl-easterns-conversation');
  });

  it('does not replace an existing lead name with the GHL fallback when the reply has no name', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-existing-name' }];
        if (sql.includes('FROM dealers')) return [{ id: 'dealer-stafford', code: 'STAFFORD', name: 'Offlease Motors Stafford', timezone: 'America/New_York', routing_config: {} }];
        if (sql.includes('FROM leads WHERE ghl_location_id')) return [{ id: 'lead-existing', canonical_phone: '+13015550123', first_name: 'Ana', last_name: 'Torres' }];
        if (sql.includes('FROM conversations')) return [{ id: 'conversation-existing', status: 'partial', qualification_snapshot: {}, location_snapshot: {} }];
        if (sql.includes('SELECT body FROM conversation_messages')) return [{ body: 'I am looking for an SUV.' }];
        return [];
      }),
    };
    const service = new ConversationWebhookService({ createQueryRunner: () => queryRunner } as never);

    await service.acceptCustomerReplied(
      { message_body: 'I am looking for an SUV.', contact_phone: '+13015550123', channel: 'whatsapp' },
      'stafford',
      { contactId: 'ghl-contact-existing', conversationId: 'ghl-conversation-existing' },
    );

    const leadUpdate = queryRunner.query.mock.calls.find(([sql]) => sql.includes('UPDATE leads')) as [string, unknown[]] | undefined;
    expect(leadUpdate?.[0]).toContain("LOWER($2) = 'lead'");
    expect(leadUpdate?.[1]).toEqual(['+13015550123', 'Lead', '', 'lead-existing']);
  });

  it('fails closed when a source Location ID matches more than one active dealer', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-ambiguous-conversation' }];
        if (sql.includes('FROM dealers')) return [
          { id: 'dealer-one', code: 'STAFFORD', name: 'Stafford', timezone: 'America/New_York', routing_config: {} },
          { id: 'dealer-two', code: 'FREDERICKSBURG', name: 'Fredericksburg', timezone: 'America/New_York', routing_config: {} },
        ];
        return [];
      }),
    };
    const dataSource = { createQueryRunner: () => queryRunner, query: vi.fn() } as never;
    const service = new ConversationWebhookService(dataSource);

    await expect(service.acceptCustomerReplied(
      { message_body: 'I need an SUV.', contact_phone: '+13015550123', channel: 'whatsapp' },
      'stafford',
      { contactId: 'ghl-ambiguous-contact', conversationId: 'ghl-ambiguous-conversation' },
    )).rejects.toThrow('más de un dealer activo');
    expect(queryRunner.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO leads'))).toBe(false);
  });

  it('casts the conversation status parameter consistently in the persistence update', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-status-cast' }];
        if (sql.includes('FROM dealers')) return [{ id: 'dealer-stafford', code: 'STAFFORD', name: 'Stafford', timezone: 'America/New_York', routing_config: {} }];
        if (sql.includes('FROM leads WHERE ghl_location_id')) return [{ id: 'lead-status-cast', canonical_phone: '+13015550123', first_name: 'Ana', last_name: 'Torres' }];
        if (sql.includes('FROM conversations')) return [{ id: 'conversation-status-cast', status: 'partial', qualification_snapshot: {}, location_snapshot: {} }];
        if (sql.includes('SELECT body FROM conversation_messages')) return [{ body: 'I need an SUV.' }];
        return [];
      }),
    };
    const service = new ConversationWebhookService({ createQueryRunner: () => queryRunner } as never);

    await service.acceptCustomerReplied(
      { message_body: 'I need an SUV.', contact_phone: '+13015550123', channel: 'whatsapp' },
      'stafford',
      { contactId: 'ghl-status-cast-contact', conversationId: 'ghl-status-cast-conversation' },
    );

    const conversationUpdate = queryRunner.query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(conversationUpdate?.[0]).toContain('status = $2::varchar');
    expect(conversationUpdate?.[0]).toContain("CASE WHEN $2::varchar IN ('ready', 'waiting_window', 'queued')");
  });
});
