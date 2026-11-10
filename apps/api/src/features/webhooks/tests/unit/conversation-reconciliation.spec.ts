import { describe, expect, it, vi } from 'vitest';
import { ConversationReconciliationFunctions } from '../../application/functions/conversations/conversation-reconciliation.functions';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversations/conversation-webhook.config';

describe('ConversationReconciliationFunctions', () => {
  it('reconciles vehicle and phone evidence across native sibling conversations', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) {
        return [{
          id: 'conversation-phone',
          channel: 'messenger',
          ghl_location_id: GHL_SOURCE_CONFIG['action-cars'].locationId,
          ghl_contact_id: 'mike-ferry-contact',
          ghl_conversation_id: 'ghl-phone-conversation',
          status: 'partial',
          qualification_snapshot: { real_name: 'Mike Ferry', phone: '', vehicle_type: 'Quiere hablar con un asesor', qualification_complete: false, language: 'en' },
          location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
          ready_at: null,
          next_attempt_at: null,
          last_message_at: '2026-10-24T14:29:28.606Z',
          waiting_window_attempts: 0,
          lead_id: 'lead-mike-ferry',
          canonical_phone: null,
          first_name: 'Mike',
          last_name: 'Ferry',
        }];
      }
      if (sql.includes('INNER JOIN conversations sibling')) {
        return [
          { body: 'SUV 07 09 chevy trailblazer', direction: 'inbound', occurred_at: '2026-10-24T14:24:17.459Z' },
          { body: '503 990 3482', direction: 'inbound', occurred_at: '2026-10-24T14:29:28.606Z' },
        ];
      }
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
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-action-en', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'waiting_window', nextAttemptAt: '2026-10-24T14:29:43.606Z' }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-phone', new Date('2026-10-24T14:29:35.000Z'), true);

    const siblingQuery = query.mock.calls.find(([sql]) => sql.includes('INNER JOIN conversations sibling')) as [string, unknown[]] | undefined;
    expect(siblingQuery?.[1]).toEqual([GHL_SOURCE_CONFIG['action-cars'].locationId, 'mike-ferry-contact', 'messenger']);
    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ phone: '+15039903482', vehicle_type: 'SUV' });
    expect(qualification.statusForConversation).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15039903482', vehicle_type: 'SUV' }),
      expect.any(Object),
      expect.any(Object),
      'action-cars',
      expect.any(Date),
      'capture',
      expect.anything(),
      0,
    );
    expect(conversationUpdate?.[1]?.[1]).toBe('waiting_window');
    expect(conversationUpdate?.[1]?.[4]).toBe('2026-10-24T14:34:35.000Z');
    expect(conversationUpdate?.[1]?.[6]).toBe(0);
  });

  it('repairs a stale Messenger channel from the native GHL WhatsApp message type', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-carhub-whatsapp-repair',
        channel: 'messenger',
        ghl_location_id: GHL_SOURCE_CONFIG.carhub.locationId,
        ghl_contact_id: 'carhub-whatsapp-repair-contact',
        ghl_conversation_id: 'carhub-whatsapp-repair-conversation',
        status: 'partial',
        qualification_snapshot: { real_name: '', phone: '', vehicle_type: '', qualification_complete: false, language: 'es' },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: null,
        last_message_at: '2026-11-06T15:00:00.000Z',
        waiting_window_attempts: 0,
        lead_id: 'lead-carhub-whatsapp-repair',
        canonical_phone: null,
        first_name: 'Nolberto',
        last_name: 'Ballestero',
      }];
      if (sql.includes('SELECT cm.body')) return [{
        body: 'Busco una SUV',
        direction: 'inbound',
        occurred_at: '2026-11-06T15:00:00.000Z',
        raw_payload: { message: { type: 19 }, customData: { channel: 'messenger', contact_phone: '(571) 733-3939' } },
      }];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-carhub', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'waiting_window', nextAttemptAt: '2026-11-06T15:05:00.000Z' }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-carhub-whatsapp-repair', new Date('2026-11-06T15:01:00.000Z'), true);

    expect(query.mock.calls.some((call) => {
      const [sql, params] = call as unknown as [string, unknown[]];
      return sql.includes('UPDATE conversations SET channel = $2') && params?.[1] === 'whatsapp';
    })).toBe(true);
    const qualificationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(qualificationUpdate?.[1]?.[2]))).toMatchObject({ phone: '+15717333939', vehicle_type: 'SUV' });
  });

  it('uses the Action Cars Spanish Messenger answer after the outbound name prompt', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-action-spanish-name',
        channel: 'messenger',
        ghl_location_id: GHL_SOURCE_CONFIG['action-cars'].locationId,
        ghl_contact_id: 'action-spanish-name-contact',
        ghl_conversation_id: 'ghl-action-spanish-name',
        status: 'partial',
        qualification_snapshot: {
          real_name: '',
          profile_name: 'Nombre de perfil',
          phone: '',
          vehicle_type: '',
          qualification_complete: false,
          language: 'es',
        },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: null,
        last_message_at: '2026-11-05T15:00:00.000Z',
        waiting_window_attempts: 0,
        lead_id: 'lead-action-spanish-name',
        canonical_phone: null,
        first_name: '',
        last_name: '',
      }];
      if (sql.includes('SELECT cm.body')) return [
        { body: '¿Cuál es tu nombre completo?', direction: 'outbound', occurred_at: '2026-11-05T14:58:00.000Z' },
        { body: 'Me llamo Juan Pérez', direction: 'inbound', occurred_at: '2026-11-05T14:59:00.000Z' },
        { body: 'Busco una Mazda 300', direction: 'inbound', occurred_at: '2026-11-05T15:00:00.000Z' },
        { body: '3015550123', direction: 'inbound', occurred_at: '2026-11-05T15:00:01.000Z' },
      ];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-action-es', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'waiting_window', nextAttemptAt: '2026-11-05T15:05:00.000Z' }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-action-spanish-name', new Date('2026-11-05T15:01:00.000Z'), true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({
      real_name: 'Juan Pérez',
      profile_name: 'Nombre de perfil',
      vehicle_type: 'Mazda 300',
    });
  });

  it('uses the native WhatsApp name nested in custom_data during a targeted queued replay', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM invalid_real_names')) return [{ normalized_value: 'itin' }];
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-lucki-adriana',
        channel: 'whatsapp',
        ghl_location_id: GHL_SOURCE_CONFIG.lucki.locationId,
        ghl_contact_id: 'lucki-adriana-contact',
        ghl_conversation_id: 'lucki-adriana-conversation',
        status: 'queued',
        qualification_snapshot: {
          real_name: 'Itin',
          profile_name: '',
          phone: '+17039406305',
          vehicle_type: 'Honda element',
          qualification_complete: true,
          language: 'es',
        },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: null,
        last_message_at: '2026-11-05T15:14:48.190Z',
        waiting_window_attempts: 0,
        lead_id: 'lead-lucki-adriana',
        canonical_phone: '+17039406305',
        first_name: 'Employee',
        last_name: 'Action Log Created',
      }];
      if (sql.includes('SELECT cm.body')) return [
        { body: 'BUSCO UNA SUV', direction: 'inbound', occurred_at: '2026-11-05T04:13:52.160Z', raw_payload: { custom_data: { channel: 'whatsapp', contact_name: 'Adriana', contact_phone: '(703) 940-6305' } } },
        { body: 'Honda', direction: 'inbound', occurred_at: '2026-11-05T05:07:36.811Z', raw_payload: { custom_data: { channel: 'whatsapp', contact_name: 'Adriana' } } },
        { body: 'Employee action log created', direction: 'outbound', occurred_at: '2026-11-05T05:07:43.349Z', raw_payload: {} },
        { body: 'Si es mi.primera vez', direction: 'inbound', occurred_at: '2026-11-05T15:14:28.466Z', raw_payload: { custom_data: { channel: 'whatsapp', contact_name: 'Adriana' } } },
        { body: 'Tiene ho da element?', direction: 'inbound', occurred_at: '2026-11-05T15:14:48.190Z', raw_payload: { custom_data: { channel: 'whatsapp', contact_name: 'Adriana' } } },
        { body: 'Itin', direction: 'inbound', occurred_at: '2026-11-05T15:30:44.310Z', raw_payload: { customData: { channel: 'whatsapp', contact_name: 'Adriana', message_body: 'Itin' } } },
      ];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-lucki', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'queued', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-lucki-adriana', new Date('2026-11-05T15:15:00.000Z'), true, true, true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({
      real_name: 'Adriana',
      phone: '+17039406305',
      identification: 'yes',
      documents: expect.stringContaining('identification: yes'),
    });
  });

  it('reconciles CarHub form facts before the Messenger profile label', async () => {
    const form = `*Headline:* El Secreto para Conseguir las MEJORES Ofertas en Autos
*Source URL:* https://fb.me/5eo7ugHfj
¡Hola! Completé el formulario y me gustaría obtener más información sobre el negocio.
Phone number: (301) 956-0179
¿Prefieres pagar de contado o financiar?: Financiamiento
¿En qué rango se encuentra tu puntaje de crédito?: 450 - 550
¿Cuánto planeas dar de enganche?: Planeo usar mi vehículo actual como (parte del) enganche
Full name: Jose Eduardo Martins Cabral
¿Cuándo planeas comprar tu próximo vehículo?: Entre 1 semana y 1 mes
¿Prefieres que te contactemos por llamada o mensaje de texto?: Mensaje de texto
¿Hay algún tipo de vehículo que te interese?: SUV`;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-carhub-form',
        channel: 'messenger',
        ghl_location_id: GHL_SOURCE_CONFIG.carhub.locationId,
        ghl_contact_id: 'kDHezyCgTFC6nTOWgBiy',
        ghl_conversation_id: 'HRl44GNFfyf7SHDVAK5V',
        status: 'waiting_window',
        qualification_snapshot: {
          real_name: 'Eduardoxeca',
          profile_name: 'Eduardoxeca',
          phone: '+13019560179',
          vehicle_type: '',
          qualification_complete: false,
        },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: '2026-11-05T15:25:00.000Z',
        last_message_at: '2026-11-05T15:22:20.768Z',
        waiting_window_attempts: 1,
        lead_id: 'lead-carhub-form',
        canonical_phone: '+13019560179',
        first_name: 'Eduardoxeca',
        last_name: '',
      }];
      if (sql.includes('SELECT cm.body')) return [
        { body: form, direction: 'inbound', occurred_at: '2026-11-05T15:20:30.038Z' },
        { body: 'Volkswagen Jetta TDI 2014', direction: 'inbound', occurred_at: '2026-11-05T15:22:20.768Z' },
      ];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-carhub', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'waiting_window', nextAttemptAt: '2026-11-05T15:27:00.000Z' }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-carhub-form', new Date('2026-11-05T15:23:00.000Z'), true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({
      real_name: 'Jose Eduardo Martins Cabral',
      vehicle_type: 'SUV',
      form_context: {
        full_name: 'Jose Eduardo Martins Cabral',
        vehicle: 'SUV',
        credit_score_range: '450 - 550',
      },
    });
  });

  it('preserves the lead canonical phone when Messenger history has no phone candidate', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) {
        return [{
          id: 'conversation-messenger-phone',
          channel: 'messenger',
          ghl_location_id: GHL_SOURCE_CONFIG.easterns.locationId,
          ghl_contact_id: 'messenger-phone-contact',
          ghl_conversation_id: 'contact:messenger-phone-contact:messenger',
          status: 'partial',
          qualification_snapshot: { real_name: 'Messenger Lead', phone: '', vehicle_type: 'SUV', qualification_complete: false },
          location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
          ready_at: null,
          next_attempt_at: null,
          last_message_at: '2026-10-18T17:59:00.000Z',
          waiting_window_attempts: 0,
          lead_id: 'lead-messenger-phone',
          canonical_phone: '+13015550123',
          first_name: 'Messenger',
          last_name: 'Lead',
        }];
      }
      if (sql.includes('SELECT cm.body')) return [{ body: 'I am looking for an SUV.', direction: 'inbound', occurred_at: '2026-10-18T17:59:00.000Z' }];
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
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-easterns', timezone: 'America/New_York', routing_config: { group: 'Easterns' } }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'partial', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-messenger-phone', new Date('2026-10-18T18:05:00.000Z'));

    expect(String(query.mock.calls[0]?.[0])).toContain("idle_in_transaction_session_timeout = '15s'");
    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ phone: '+13015550123' });
  });

  it('counts only a successful Guard reconciliation and schedules the next five-minute cycle', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) {
        return [{
          id: 'conversation-waiting',
          channel: 'messenger',
          ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
          ghl_contact_id: 'waiting-contact',
          ghl_conversation_id: 'ghl-waiting',
          status: 'waiting_window',
          qualification_snapshot: {
            real_name: 'Waiting Lead',
            phone: '+17035550123',
            vehicle_type: 'Honda Civic',
            qualification_complete: false,
            language: 'en',
          },
          location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
          ready_at: '2026-10-18T18:00:00.000Z',
          next_attempt_at: '2026-10-18T18:00:00.000Z',
          last_message_at: '2026-10-18T17:59:00.000Z',
          waiting_window_attempts: 2,
          lead_id: 'lead-waiting',
          canonical_phone: '+17035550123',
          first_name: 'Waiting',
          last_name: 'Lead',
        }];
      }
      if (sql.includes('SELECT cm.body')) {
        return [{ body: 'Todavía busco un Honda Civic.', direction: 'inbound', occurred_at: '2026-10-18T17:59:00.000Z' }];
      }
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
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn(),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );
    const now = new Date('2026-10-18T18:05:00.000Z');

    await reconciliation.reconcileConversation('conversation-waiting', now, true, true, false, true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(conversationUpdate?.[1]?.[4]).toBe('2026-10-18T18:10:00.000Z');
    expect(conversationUpdate?.[1]?.[6]).toBe(3);
    expect(qualification.statusForConversation).not.toHaveBeenCalled();
  });

  it('does not count the same waiting_window cycle twice after the due workflow already rescheduled it', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) {
        return [{
          id: 'conversation-rescheduled',
          channel: 'messenger',
          ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
          ghl_contact_id: 'rescheduled-contact',
          ghl_conversation_id: 'ghl-rescheduled',
          status: 'waiting_window',
          qualification_snapshot: { real_name: 'Waiting Lead', phone: '+17035550123', vehicle_type: 'Sedan', qualification_complete: false, language: 'en' },
          location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
          ready_at: '2026-10-18T18:00:00.000Z',
          next_attempt_at: '2026-10-18T18:10:00.000Z',
          last_message_at: '2026-10-18T17:59:00.000Z',
          waiting_window_attempts: 1,
          lead_id: 'lead-rescheduled',
          canonical_phone: '+17035550123',
          first_name: 'Waiting',
          last_name: 'Lead',
        }];
      }
      if (sql.includes('SELECT cm.body')) return [{ body: 'Todavía busco un Sedan.', direction: 'inbound', occurred_at: '2026-10-18T17:59:00.000Z' }];
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
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'waiting_window', nextAttemptAt: '2026-10-18T18:15:00.000Z' }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-rescheduled', new Date('2026-10-18T18:05:00.000Z'), true, true, false, true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(conversationUpdate?.[1]?.[6]).toBe(1);
  });

  it('keeps the Instagram display name in qualification and lead identity', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-como-asi',
        channel: 'instagram',
        ghl_location_id: GHL_SOURCE_CONFIG.arlington.locationId,
        ghl_contact_id: 'como-asi-contact',
        ghl_conversation_id: 'ghl-como-asi',
        status: 'queued',
        qualification_snapshot: { real_name: 'Como Así', phone: '+12405215639', vehicle_type: 'Infiniti q50', qualification_complete: true },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: null,
        last_message_at: '2026-10-26T19:42:23.354Z',
        waiting_window_attempts: 2,
        lead_id: 'lead-como-asi',
        canonical_phone: '+12405215639',
        first_name: 'Como',
        last_name: 'Así',
      }];
      if (sql.includes('SELECT cm.body')) return [
        { body: 'Tienen Infiniti q50', direction: 'inbound', occurred_at: '2026-10-26T19:40:00.000Z' },
        { body: '2405215639', direction: 'inbound', occurred_at: '2026-10-26T19:41:00.000Z' },
        { body: 'Como así ?', direction: 'inbound', occurred_at: '2026-10-26T19:42:23.354Z' },
      ];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-arlington', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'queued', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-como-asi', new Date('2026-10-26T19:45:00.000Z'), true, false, true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ real_name: '', phone: '+12405215639', vehicle_type: 'Infiniti q50' });
    const leadUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE leads SET first_name')) as [string, unknown[]] | undefined;
    expect(leadUpdate).toBeDefined();
  });

  it('promotes the native Messenger profile over a stale campaign label', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-messenger-stale-profile',
        channel: 'messenger',
        ghl_location_id: GHL_SOURCE_CONFIG['fredericksburg-2'].locationId,
        ghl_contact_id: 'stale-messenger-contact',
        ghl_conversation_id: 'ghl-stale-messenger',
        status: 'queued',
        qualification_snapshot: {
          real_name: 'Muy Honesta Contigo Es',
          profile_name: 'Jlp Lopez',
          phone: '+14343286704',
          vehicle_type: 'Camaro 2017',
          qualification_complete: true,
        },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: null,
        last_message_at: '2026-11-03T16:00:12.073Z',
        waiting_window_attempts: 0,
        lead_id: 'lead-stale-messenger',
        canonical_phone: '+14343286704',
        first_name: 'Muy',
        last_name: 'Honesta Contigo Es',
      }];
      if (sql.includes('SELECT cm.body')) return [
        { body: 'Busco algún honda.', direction: 'inbound', occurred_at: '2026-11-03T15:59:29.540Z' },
        { body: 'ESta a viendo un lexsus Y me gustó. Era un 2010', direction: 'inbound', occurred_at: '2026-11-03T16:00:12.073Z' },
      ];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-fredericksburg-2', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'queued', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-messenger-stale-profile', new Date('2026-11-03T16:01:00.000Z'), true, true, true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ real_name: 'Jlp Lopez', profile_name: 'Jlp Lopez' });
    const leadUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE leads SET first_name')) as [string, unknown[]] | undefined;
    expect(leadUpdate?.[1]).toEqual(['lead-stale-messenger', 'Jlp', 'Lopez']);
  });

  it('clears a conversational reply during the ordinary watchdog cycle', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM invalid_real_names')) return [{ normalized_value: 'como así' }];
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-como-asi-cycle',
        channel: 'instagram',
        ghl_location_id: GHL_SOURCE_CONFIG.arlington.locationId,
        ghl_contact_id: 'como-asi-cycle-contact',
        ghl_conversation_id: 'ghl-como-asi-cycle',
        status: 'waiting_window',
        qualification_snapshot: { real_name: 'Como Así', phone: '+12405215639', vehicle_type: 'Infiniti q50', qualification_complete: true },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: '2026-10-26T19:40:00.000Z',
        next_attempt_at: '2026-10-26T19:50:00.000Z',
        last_message_at: '2026-10-26T19:42:23.354Z',
        waiting_window_attempts: 4,
        lead_id: 'lead-como-asi-cycle',
        canonical_phone: '+12405215639',
        first_name: 'Como',
        last_name: 'Así',
      }];
      if (sql.includes('SELECT cm.body')) return [
        { body: 'Tienen Infiniti q50', direction: 'inbound', occurred_at: '2026-10-26T19:40:00.000Z' },
        { body: '2405215639', direction: 'inbound', occurred_at: '2026-10-26T19:41:00.000Z' },
        { body: 'Como así ?', direction: 'inbound', occurred_at: '2026-10-26T19:42:23.354Z' },
      ];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-arlington', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'waiting_window', nextAttemptAt: '2026-10-26T20:00:00.000Z' }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-como-asi-cycle', new Date('2026-10-26T19:55:00.000Z'), true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ real_name: '', phone: '+12405215639', vehicle_type: 'Infiniti q50' });
    const leadUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE leads SET first_name')) as [string, unknown[]] | undefined;
    expect(leadUpdate).toBeDefined();
  });

  it('repairs a bad profile label from the name explicitly declared in the transcript', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('SELECT c.id, c.channel')) {
        return [{
          id: 'conversation-manuel',
          channel: 'whatsapp',
          ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
          ghl_contact_id: 'J6uI4hMMmyueyDB3OkTG',
          ghl_conversation_id: 'contact:J6uI4hMMmyueyDB3OkTG:whatsapp',
          status: 'queued',
          qualification_snapshot: {
            real_name: 'Me Puede Mandar Fotos',
            phone: '+14103016969',
            vehicle_type: 'Honda Civic',
            vehicle_year: 2010,
            down_payment: '15',
            purchase_timeline: 'next month',
            documents: 'identification: no; proof of income: no',
            identification: 'no',
            bank_account: 'no',
            qualification_memory: 'real_name: Me Puede Mandar Fotos; vehicle: Honda Civic; down payment: 15',
            qualification_complete: false,
          },
          location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
          ready_at: null,
          next_attempt_at: null,
          last_message_at: '2026-10-18T18:00:00.000Z',
          waiting_window_attempts: 5,
          waiting_window_started_at: '2026-10-18T17:35:00.000Z',
          lead_id: 'lead-manuel',
          canonical_phone: '+14103016969',
          first_name: 'Me Puede Mandar',
          last_name: 'Fotos',
        }];
      }
      if (sql.includes('SELECT cm.body')) {
        return [
          { body: '¿Cuál es tu nombre?', direction: 'outbound', occurred_at: '2026-10-18T17:58:30.000Z' },
          { body: 'Hola cómo está mi nombre es Manuel', direction: 'inbound', occurred_at: '2026-10-18T17:59:00.000Z' },
          { body: 'Ando buscando un Honda civic 2014/15', direction: 'inbound', occurred_at: '2026-10-18T18:00:00.000Z' },
          { body: 'I have my ID and proof of income. I have a bank account. I want to buy this week.', direction: 'inbound', occurred_at: '2026-10-18T18:01:00.000Z' },
        ];
      }
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
    const dataSource = { createQueryRunner: () => runner };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'queued', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const queueService = { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() };
    const reconciliation = new ConversationReconciliationFunctions(dataSource as never, qualification as never, queueService as never);

    await reconciliation.reconcileConversation('conversation-manuel', new Date('2026-10-18T18:05:00.000Z'), true, false, true);

    const leadUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE leads SET first_name'));
    expect(leadUpdate?.[1]).toEqual(['lead-manuel', 'Manuel', '']);
    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({
      real_name: 'Manuel',
      vehicle_type: 'Honda Civic 2015',
      vehicle_year: 2015,
      down_payment: '',
      purchase_timeline: 'this week',
      identification: 'yes',
      bank_account: 'yes',
    });
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2])).documents).toMatch(/proof of income: yes/);
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2])).qualification_memory).not.toContain('down payment: 15');
    expect(conversationUpdate?.[1]?.[1]).toBe('queued');
    expect(String(conversationUpdate?.[0])).toContain("WHEN $2::varchar IN ('ready', 'queued') THEN waiting_window_attempts");
    expect(String(conversationUpdate?.[0])).toContain("WHEN $2::varchar = 'queued' THEN waiting_window_started_at");
    expect(qualification.syncLeadDealer).toHaveBeenCalledWith(
      runner,
      expect.objectContaining({ id: 'dealer-stafford' }),
      'lead-manuel',
      expect.objectContaining({ purchase_timeline: 'this week', bank_account: 'yes' }),
      expect.any(Object),
      'stafford',
    );
  });

  it('lets a declared WhatsApp name replace the native fallback name', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-whatsapp-declared-name',
        channel: 'whatsapp',
        ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
        ghl_contact_id: 'whatsapp-declared-name-contact',
        ghl_conversation_id: 'whatsapp-declared-name-conversation',
        status: 'partial',
        qualification_snapshot: {
          real_name: 'Alejandro',
          phone: '+13015550123',
          vehicle_type: 'Honda Civic',
          qualification_complete: false,
          language: 'es',
        },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: null,
        last_message_at: '2026-11-07T13:41:19.885Z',
        lead_id: 'lead-whatsapp-declared-name',
        canonical_phone: '+13015550123',
        first_name: 'Alejandro',
        last_name: '',
      }];
      if (sql.includes('SELECT cm.body')) return [
        { body: 'Estoy buscando una Honda Civic', direction: 'inbound', occurred_at: '2026-11-07T13:40:00.000Z', raw_payload: { customData: { channel: 'whatsapp', contact_name: 'Alejandro' } } },
        { body: '¿Cuál es tu nombre?', direction: 'outbound', occurred_at: '2026-11-07T13:41:00.000Z', raw_payload: {} },
        { body: 'Hola buen día, mi nombre es Edwin', direction: 'inbound', occurred_at: '2026-11-07T13:41:19.885Z', raw_payload: { customData: { channel: 'whatsapp', contact_name: 'Alejandro' } } },
      ];
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'waiting_window', nextAttemptAt: '2026-11-07T13:46:19.885Z' }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-whatsapp-declared-name', new Date('2026-11-07T13:42:00.000Z'), true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ real_name: 'Edwin' });
    const leadUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE leads SET first_name')) as [string, unknown[]] | undefined;
    expect(leadUpdate?.[1]).toEqual(['lead-whatsapp-declared-name', 'Edwin', '']);
  });

  it('keeps a later declared name over an earlier bank-account answer and learns only the label', async () => {
    const messages = [
      { body: '¿Cuál es tu nombre?', direction: 'outbound', occurred_at: '2026-11-09T20:58:30.193Z' },
      { body: 'Yo tengo social y todos mis papeles en regla', direction: 'inbound', occurred_at: '2026-11-09T21:00:15.847Z' },
      { body: 'Cuenta de banco y quiero sacar un carro financiado pero vivo en Carolina del Norte', direction: 'inbound', occurred_at: '2026-11-09T21:00:26.420Z' },
      { body: '¿Me podrías decir tu nombre para continuar con tu registro?', direction: 'outbound', occurred_at: '2026-11-09T21:00:50.062Z' },
      { body: '¿Cómo te llamas?', direction: 'outbound', occurred_at: '2026-11-10T01:12:44.522Z' },
      { body: 'Me llamo José Velázquez', direction: 'inbound', occurred_at: '2026-11-10T01:33:18.423Z' },
      { body: 'Una troca', direction: 'inbound', occurred_at: '2026-11-10T01:43:45.457Z' },
    ];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) return [{
        id: 'conversation-stafford-account-label',
        channel: 'whatsapp',
        ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
        ghl_contact_id: 'stafford-account-label-contact',
        ghl_conversation_id: 'stafford-account-label-conversation',
        status: 'queued',
        qualification_snapshot: {
          real_name: 'Cuenta de Banco',
          phone: '+12523039628',
          vehicle_type: 'Truck',
          qualification_complete: true,
          language: 'es',
        },
        location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
        ready_at: null,
        next_attempt_at: null,
        last_message_at: '2026-11-10T01:47:18.480Z',
        waiting_window_attempts: 5,
        lead_id: 'lead-stafford-account-label',
        canonical_phone: '+12523039628',
        first_name: 'Cuenta',
        last_name: 'de Banco',
      }];
      if (sql.includes('FROM invalid_real_names')) return [];
      if (sql.includes('SELECT cm.body')) return messages;
      return [];
    });
    const runner = { connect: vi.fn(), startTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(), isTransactionActive: true, query };
    const qualification = {
      resolveLocation: vi.fn().mockResolvedValue({ city: 'Wilson', state: 'NC', zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'queued', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-stafford-account-label', new Date('2026-11-10T02:20:00.000Z'), true, false, true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(conversationUpdate?.[1]?.[2]))).toMatchObject({ real_name: 'José Velázquez' });
    const leadUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE leads SET first_name')) as [string, unknown[]] | undefined;
    expect(leadUpdate?.[1]).toEqual(['lead-stafford-account-label', 'José', 'Velázquez']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO invalid_real_names'), ['cuenta de banco', 'Cuenta de banco']);
  });

  it('keeps the terminal waiting-window cycle count when ready is promoted to queued', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) {
        return [{
          id: 'conversation-terminal-cycle',
          channel: 'messenger',
          ghl_location_id: GHL_SOURCE_CONFIG.arlington.locationId,
          ghl_contact_id: 'terminal-cycle-contact',
          ghl_conversation_id: 'terminal-cycle-ghl',
          status: 'waiting_window',
          qualification_snapshot: {
            real_name: 'Terminal Cycle',
            phone: '+15555550123',
            vehicle_type: 'Honda Civic',
            qualification_complete: true,
            language: 'en',
          },
          location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
          ready_at: '2026-10-27T19:00:00.000Z',
          next_attempt_at: '2026-10-27T19:05:00.000Z',
          last_message_at: '2026-10-27T19:04:00.000Z',
          waiting_window_attempts: 5,
          waiting_window_started_at: '2026-10-27T18:40:00.000Z',
          lead_id: 'lead-terminal-cycle',
          canonical_phone: '+15555550123',
          first_name: 'Terminal',
          last_name: 'Cycle',
        }];
      }
      if (sql.includes('INNER JOIN conversations sibling')) {
        return [{ body: 'Honda Civic', direction: 'inbound', occurred_at: '2026-10-27T19:04:00.000Z' }];
      }
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
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-arlington', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'ready', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const queueService = { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      queueService as never,
    );

    await reconciliation.reconcileConversation('conversation-terminal-cycle', new Date('2026-10-27T19:06:00.000Z'), true);

    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot')) as [string, unknown[]] | undefined;
    expect(String(conversationUpdate?.[0])).toContain("WHEN $2::varchar IN ('ready', 'queued') THEN waiting_window_attempts");
    expect(conversationUpdate?.[1]?.[1]).toBe('ready');
    const queuedUpdate = query.mock.calls.find(([sql]) => sql.includes("UPDATE conversations SET status = 'queued'"));
    expect(queuedUpdate).toBeDefined();
  });

  it('clears a Stafford WhatsApp vehicle label from the lead name when no buyer name was declared', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT c.id, c.channel')) {
        return [{
          id: 'conversation-stafford-label',
          channel: 'whatsapp',
          ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
          ghl_contact_id: 'stafford-label-contact',
          ghl_conversation_id: 'contact:stafford-label-contact:whatsapp',
          status: 'queued',
          qualification_snapshot: { phone: '+17712024963', vehicle_type: 'Ford Explorer', real_name: '' },
          location_snapshot: { city: null, state: null, zip_code: null, easterns_zone: null },
          ready_at: null,
          next_attempt_at: null,
          last_message_at: '2026-10-19T17:31:00.000Z',
          lead_id: 'lead-stafford-label',
          canonical_phone: '+17712024963',
          first_name: 'Un Ford Explorer',
          last_name: 'Estoppel',
        }];
      }
      if (sql.includes('SELECT cm.body')) {
        return [
          { body: 'T', direction: 'inbound', occurred_at: '2026-10-19T17:30:37.000Z' },
          { body: 'Un Ford Explorer estoppel', direction: 'inbound', occurred_at: '2026-10-19T17:30:54.000Z' },
        ];
      }
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
      resolveLocation: vi.fn().mockResolvedValue({ city: null, state: null, zip_code: null, easterns_zone: null }),
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-stafford', timezone: 'America/New_York', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'queued', nextAttemptAt: null }),
      syncLeadDealer: vi.fn(),
    };
    const reconciliation = new ConversationReconciliationFunctions(
      { createQueryRunner: () => runner } as never,
      qualification as never,
      { createQueuedPauseEvent: vi.fn(), dispatchQueuedPauseEvent: vi.fn() } as never,
    );

    await reconciliation.reconcileConversation('conversation-stafford-label', new Date('2026-10-19T18:00:00.000Z'), true, false, true);

    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE leads SET first_name = '', last_name = ''"))).toBe(true);
  });
});
