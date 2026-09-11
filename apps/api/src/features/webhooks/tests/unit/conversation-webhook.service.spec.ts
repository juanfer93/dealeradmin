import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  ConversationWebhookService,
  CONVERSATION_STABILIZATION_MS,
  GHL_SOURCE_CONFIG,
  INCOMPLETE_QUALIFICATION_WINDOW_HOURS,
  OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS,
  QUALIFICATION_RULE_TIMEZONE,
} from '../../application/conversation-webhook.service';
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

  function evaluateStatus(
    snapshot: Record<string, unknown>,
    location: Record<string, unknown>,
    dealer: Record<string, unknown>,
    source: 'stafford' | 'easterns',
    now: Date,
    phase: 'capture' | 'due',
    readyAt?: string,
  ) {
    const service = new ConversationWebhookService();
    return (service as unknown as {
      statusForConversation: (...args: unknown[]) => { status: string; nextAttemptAt: string | null };
    }).statusForConversation(snapshot, location, dealer, source, now, phase, readyAt);
  }

  const completeSnapshot = { phone: '+13015550123', vehicle_type: 'SUV', qualification_complete: true };
  const incompleteSnapshot = { phone: '+13015550123', vehicle_type: 'SUV', qualification_complete: false };
  const easternsLocation = { city: 'Laurel', state: 'MD', zip_code: null, easterns_zone: null };
  const easternsDealer = { timezone: 'America/New_York', routing_config: { group: 'Easterns' } };

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

  it('configures Arlington Woodbridge as a Messenger/Instagram conversation source', async () => {
    expect(GHL_SOURCE_CONFIG.arlington).toEqual({
      locationId: '9v8zH9Y5eLiiJwZTZDci',
      defaultChannel: 'messenger',
    });

    const service = new ConversationWebhookService();
    const result = await service.acceptCustomerReplied(
      { message_body: 'I need an SUV.', channel: 'instagram' },
      'arlington',
      { contactId: 'ghl-arlington-contact', conversationId: 'ghl-arlington-conversation' },
    );

    expect(result).toMatchObject({ source: 'arlington', conversationId: 'ghl-arlington-conversation' });
    expect(getTestConversationEvents()).toEqual([
      expect.objectContaining({ source: 'arlington', channel: 'instagram' }),
    ]);
  });

  it('keeps the two Koons Fredericksburg dealers as separate Messenger/Instagram sources', async () => {
    expect(GHL_SOURCE_CONFIG['koons-fred']).toEqual({
      locationId: 'xuHo0opTO2g5edIuPJRl',
      defaultChannel: 'messenger',
    });
    expect(GHL_SOURCE_CONFIG['koons-fred-eng']).toEqual({
      locationId: 'ozAIEblxTjrh0PfoaHge',
      defaultChannel: 'messenger',
    });

    const service = new ConversationWebhookService();
    const spanish = await service.acceptCustomerReplied(
      { message_body: 'Busco un SUV.', channel: 'instagram' },
      'koons-fred',
      { contactId: 'ghl-koons-es-contact', conversationId: 'ghl-koons-es-conversation' },
    );
    const english = await service.acceptCustomerReplied(
      { message_body: 'I am looking for an SUV.', channel: 'messenger' },
      'koons-fred-eng',
      { contactId: 'ghl-koons-en-contact', conversationId: 'ghl-koons-en-conversation' },
    );

    expect(spanish).toMatchObject({ source: 'koons-fred', conversationId: 'ghl-koons-es-conversation' });
    expect(english).toMatchObject({ source: 'koons-fred-eng', conversationId: 'ghl-koons-en-conversation' });
    expect(getTestConversationEvents()).toEqual([
      expect.objectContaining({ source: 'koons-fred', channel: 'instagram' }),
      expect.objectContaining({ source: 'koons-fred-eng', channel: 'messenger' }),
    ]);
  });

  it('configures Koons Automotive of Culpeper as a separate Messenger source', async () => {
    expect(GHL_SOURCE_CONFIG['koons-culpeper']).toEqual({
      locationId: 'bTNJHpNZ8FaS1PUHkuUq',
      defaultChannel: 'messenger',
    });

    const service = new ConversationWebhookService();
    const result = await service.acceptCustomerReplied(
      { message_body: 'I am looking for an SUV.', channel: 'messenger' },
      'koons-culpeper',
      { contactId: 'ghl-koons-culpeper-contact', conversationId: 'ghl-koons-culpeper-conversation' },
    );

    expect(result).toMatchObject({ source: 'koons-culpeper', conversationId: 'ghl-koons-culpeper-conversation' });
    expect(getTestConversationEvents()).toEqual([
      expect.objectContaining({ source: 'koons-culpeper', channel: 'messenger' }),
    ]);
  });

  it('splits the shared Action Pre Owned Cars source into Spanish and English queues', async () => {
    expect(GHL_SOURCE_CONFIG['action-cars']).toEqual({
      locationId: 'ZxadcudjvBz7KFCB1od4',
      defaultChannel: 'messenger',
      splitByLanguage: true,
    });

    const queryRunner = {
      query: vi.fn(async (sql: string) => sql.includes('FROM dealers') ? [
        { id: 'dealer-action-es', code: 'ACTION-CARS-ES', name: 'Action Pre Owned Cars Español', timezone: 'America/New_York', routing_config: { group: 'Action Pre Owned Cars', language: 'es' } },
        { id: 'dealer-action-en', code: 'ACTION-CARS-EN', name: 'Action Pre Owned Cars English', timezone: 'America/New_York', routing_config: { group: 'Action Pre Owned Cars', language: 'en' } },
      ] : []),
    };
    const service = new ConversationWebhookService();
    const findSourceDealer = (service as unknown as {
      findSourceDealer: (...args: unknown[]) => Promise<{ id: string; name: string }>;
    }).findSourceDealer;

    await expect(findSourceDealer.call(service, queryRunner, 'ZxadcudjvBz7KFCB1od4', 'action-cars', 'es')).resolves.toMatchObject({ id: 'dealer-action-es' });
    await expect(findSourceDealer.call(service, queryRunner, 'ZxadcudjvBz7KFCB1od4', 'action-cars', 'en')).resolves.toMatchObject({ id: 'dealer-action-en' });
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
    const conversationUpdate = queryRunner.query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ real_name: '' });
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

  it('ignora la cola cuando el mismo nombre y teléfono ya tienen otra conversación queued', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-queued-duplicate' }];
        if (sql.includes('FROM dealers')) return [{ id: 'dealer-stafford', code: 'STAFFORD', name: 'Stafford', timezone: 'America/New_York', routing_config: {} }];
        if (sql.includes('FROM leads WHERE ghl_location_id')) return [];
        if (sql.includes('INSERT INTO leads')) return [{ id: 'lead-new', canonical_phone: '+13015550123', first_name: 'Ana', last_name: 'Torres' }];
        if (sql.includes('FROM conversations c')) return [{
          id: 'lead-queued',
          first_name: 'Ana',
          last_name: 'Torres',
          canonical_phone: '+13015550123',
          conversation_id: 'conversation-queued',
          conversation_status: 'queued',
          status: 'pending',
        }];
        if (sql.includes('FROM conversations')) return [];
        if (sql.includes('INSERT INTO conversations')) return [{ id: 'conversation-new', status: 'partial', qualification_snapshot: {}, location_snapshot: {} }];
        if (sql.includes('SELECT body FROM conversation_messages')) return [{ body: 'I am looking for an SUV.' }];
        return [];
      }),
    };
    const service = new ConversationWebhookService({ createQueryRunner: () => queryRunner } as never);

    const result = await service.acceptCustomerReplied(
      { message_body: 'I am looking for an SUV.', contact_phone: '+13015550123', contact_name: 'Ana Torres', channel: 'whatsapp' },
      'stafford',
      { contactId: 'ghl-new-contact', conversationId: 'ghl-new-conversation' },
    );

    expect(result).toMatchObject({ accepted: true, status: 'processed' });
    expect(queryRunner.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO lead_dealers'))).toBe(false);
    const duplicateUpdate = queryRunner.query.mock.calls.find(([sql]) => sql.includes('status = $2::varchar')) as [string, unknown[]] | undefined;
    expect(duplicateUpdate?.[1]).toEqual(['conversation-new', 'duplicate_ignored', expect.any(String), expect.any(String), expect.any(String)]);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('debounces a route-ready conversation for 15 seconds after capture', () => {
    const now = new Date('2026-09-11T14:00:00.000Z');
    const result = evaluateStatus(completeSnapshot, easternsLocation, easternsDealer, 'easterns', now, 'capture');

    expect(result.status).toBe('waiting_window');
    expect(result.nextAttemptAt).toBe(new Date(now.getTime() + CONVERSATION_STABILIZATION_MS).toISOString());
  });

  it('queues a complete conversation after the stabilization window', () => {
    const now = new Date('2026-09-11T14:00:15.000Z');
    const result = evaluateStatus(completeSnapshot, easternsLocation, easternsDealer, 'easterns', now, 'due', '2026-09-11T14:00:00.000Z');

    expect(result).toEqual({ status: 'ready', nextAttemptAt: null });
  });

  it('keeps incomplete conversations until the dealer-local qualification window expires', () => {
    const now = new Date('2026-09-11T14:29:59.000Z');
    const result = evaluateStatus(incompleteSnapshot, easternsLocation, easternsDealer, 'easterns', now, 'due', '2026-09-11T14:00:00.000Z');

    expect(result.status).toBe('waiting_window');
    expect(result.nextAttemptAt).toBe('2026-09-11T14:30:00.000Z');
    expect(INCOMPLETE_QUALIFICATION_WINDOW_HOURS).toBe(0.5);
  });

  it('uses the three-hour overnight rule for incomplete conversations', () => {
    const now = new Date('2026-09-11T20:00:00.000Z');
    const result = evaluateStatus(incompleteSnapshot, easternsLocation, easternsDealer, 'easterns', now, 'due', '2026-09-11T20:00:00.000Z');

    expect(result.status).toBe('waiting_window');
    expect(result.nextAttemptAt).toBe('2026-09-11T23:00:00.000Z');
    expect(OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS).toBe(3);
  });

  it('uses Colombia time for the qualification window regardless of dealer timezone', () => {
    const now = new Date('2026-09-11T19:30:00.000Z');
    const result = evaluateStatus(incompleteSnapshot, easternsLocation, { timezone: 'America/New_York', routing_config: {} }, 'easterns', now, 'due', now.toISOString());

    expect(QUALIFICATION_RULE_TIMEZONE).toBe('America/Bogota');
    expect(result.nextAttemptAt).toBe('2026-09-11T20:00:00.000Z');
  });
});
