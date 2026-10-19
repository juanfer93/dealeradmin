import { describe, expect, it, vi } from 'vitest';
import { ConversationReconciliationFunctions } from '../../application/functions/conversation-reconciliation.functions';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversation-webhook.config';

describe('ConversationReconciliationFunctions', () => {
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
