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
    );
    expect(conversationUpdate?.[1]?.[1]).toBe('waiting_window');
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
          lead_id: 'lead-manuel',
          canonical_phone: '+14103016969',
          first_name: 'Me Puede Mandar',
          last_name: 'Fotos',
        }];
      }
      if (sql.includes('SELECT cm.body')) {
        return [
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
    const conversationUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE conversations') && sql.includes('qualification_snapshot'));
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
