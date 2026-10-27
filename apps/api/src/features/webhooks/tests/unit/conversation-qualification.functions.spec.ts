import { describe, expect, it, vi } from 'vitest';
import { ConversationQualificationFunctions } from '../../application/functions/conversations/conversation-qualification.functions';

describe('ConversationQualificationFunctions', () => {
  it('does not wait on the alternating dealer lock when another cycle owns it', async () => {
    const runner = {
      query: vi.fn()
        .mockResolvedValueOnce([
          { id: 'dealer-first', code: 'first', name: 'First', timezone: 'America/New_York', routing_config: { allocation_key: 'easterns-millersville', allocation_order: 0 } },
          { id: 'dealer-second', code: 'second', name: 'Second', timezone: 'America/New_York', routing_config: { allocation_key: 'easterns-millersville', allocation_order: 1 } },
        ])
        .mockResolvedValueOnce([{ acquired: false }]),
    };

    const result = await new ConversationQualificationFunctions(
      undefined,
      { 'easterns-millersville': { locationId: 'millersville-location', defaultChannel: 'messenger', alternatingGroup: 'easterns-millersville' } } as never,
    ).findSourceDealer(runner as never, 'millersville-location', 'easterns-millersville');

    expect(result.id).toBe('dealer-first');
    expect(runner.query.mock.calls[1]?.[0]).toContain('pg_try_advisory_xact_lock');
    expect(runner.query).toHaveBeenCalledTimes(2);
  });

  it('finds reengagement by historical snapshot phone across aliases of the same dealer', async () => {
    const historicalLead = {
      id: 'lead-jason-carpenter',
      canonical_phone: null,
      first_name: 'Jason',
      last_name: 'Carpenter',
    };
    const runner = {
      query: vi.fn().mockResolvedValue([historicalLead]),
    };

    const result = await new ConversationQualificationFunctions().findExistingLeadReengagement(
      runner as never,
      '+15408184341',
      'dealer-offlease-fredericksburg',
      'conversation-current',
      '2026-10-18T08:17:50.000Z',
      '2026-10-18T08:21:45.000Z',
      'MyxWNKacThim798E8KC6',
    );

    expect(result).toEqual(historicalLead);
    const [sql, params] = runner.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("qualification_snapshot->>'phone' = $1");
    expect(sql).toContain('dealer_location_aliases');
    expect(sql).toContain('historical_location_alias');
    expect(params).toEqual([
      '+15408184341',
      'dealer-offlease-fredericksburg',
      '2026-10-18T08:17:50.000Z',
      'conversation-current',
      'MyxWNKacThim798E8KC6',
      '2026-10-18T08:21:45.000Z',
    ]);
  });

  it('recovers a concurrent conversation insert without creating a duplicate', async () => {
    const concurrentRow = {
      id: 'conversation-existing',
      status: 'partial',
      qualification_snapshot: {},
      location_snapshot: {},
      ready_at: null,
      created_at: '2026-10-17T12:00:00.000Z',
      first_message_at: '2026-10-17T12:00:00.000Z',
      has_previous_message: true,
    };
    const runner = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([concurrentRow]),
    };

    const result = await new ConversationQualificationFunctions().upsertConversation(runner as never, {
      leadId: 'lead-1',
      locationId: 'location-1',
      contactId: 'contact-1',
      conversationId: 'ghl-conversation-1',
      channel: 'messenger',
      occurredAt: '2026-10-17T12:00:00.000Z',
    });

    expect(result).toMatchObject({ ...concurrentRow, isExisting: true });
    expect(runner.query.mock.calls[1]?.[0]).toContain('ON CONFLICT (ghl_location_id, ghl_contact_id, ghl_conversation_id) DO NOTHING');
  });

  it('writes a new native conversation into the canonical row for the same dealer', async () => {
    const canonicalRow = {
      id: 'conversation-canonical',
      status: 'waiting_window',
      ghl_conversation_id: 'ghl-native-original',
      qualification_snapshot: { assigned_dealer_id: 'dealer-koons' },
      location_snapshot: {},
      ready_at: null,
      created_at: '2026-10-27T12:00:00.000Z',
      first_message_at: '2026-10-27T12:00:00.000Z',
      last_message_at: '2026-10-27T12:05:00.000Z',
    };
    const runner = { query: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([canonicalRow]) };

    const result = await new ConversationQualificationFunctions().upsertConversation(runner as never, {
      leadId: 'lead-1',
      locationId: 'location-1',
      contactId: 'contact-1',
      conversationId: 'ghl-native-rotated',
      channel: 'messenger',
      occurredAt: '2026-10-27T12:06:00.000Z',
      dealerId: 'dealer-koons',
    });

    expect(result).toMatchObject({ ...canonicalRow, isExisting: true });
    expect(runner.query).toHaveBeenCalledTimes(2);
    expect(runner.query.mock.calls[1]?.[0]).toContain("assigned_dealer_id");
    expect(runner.query.mock.calls[1]?.[1]).toEqual(['location-1', 'contact-1', 'messenger', 'dealer-koons', null]);
  });

  it('moves an already-created synthetic duplicate into the native canonical row', async () => {
    const duplicateRow = {
      id: 'conversation-synthetic',
      status: 'partial',
      ghl_conversation_id: 'contact:contact-1:messenger',
      qualification_snapshot: { assigned_dealer_id: 'dealer-koons' },
      location_snapshot: {},
      ready_at: null,
      created_at: '2026-10-27T12:01:00.000Z',
      first_message_at: '2026-10-27T12:01:00.000Z',
      last_message_at: '2026-10-27T12:02:00.000Z',
    };
    const canonicalRow = {
      id: 'conversation-native',
      status: 'waiting_window',
      ghl_conversation_id: 'ghl-native-original',
      qualification_snapshot: { assigned_dealer_id: 'dealer-koons' },
      location_snapshot: {},
      ready_at: null,
      created_at: '2026-10-27T12:00:00.000Z',
      first_message_at: '2026-10-27T12:00:00.000Z',
      last_message_at: '2026-10-27T12:05:00.000Z',
    };
    const runner = { query: vi.fn()
      .mockResolvedValueOnce([duplicateRow])
      .mockResolvedValueOnce([canonicalRow])
      .mockResolvedValue([]) };

    const result = await new ConversationQualificationFunctions().upsertConversation(runner as never, {
      leadId: 'lead-1',
      locationId: 'location-1',
      contactId: 'contact-1',
      conversationId: 'contact:contact-1:messenger',
      channel: 'messenger',
      occurredAt: '2026-10-27T12:06:00.000Z',
      dealerId: 'dealer-koons',
    });

    expect(result).toMatchObject({ ...canonicalRow, isExisting: true });
    expect(runner.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE conversation_messages'))).toBe(true);
    expect(runner.query.mock.calls.some(([sql]) => String(sql).includes("status = 'duplicate_ignored'"))).toBe(true);
  });

  it('puts Stafford WhatsApp into the waiting window with its native phone and vehicle', () => {
    const result = new ConversationQualificationFunctions().statusForConversation(
      {
        real_name: '',
        phone: '+12405550123',
        vehicle_type: 'Honda Civic',
        qualification_complete: true,
      } as never,
      { city: null, state: null, zip_code: null, easterns_zone: null },
      { id: 'dealer-stafford', routing_config: {} } as never,
      'stafford',
      new Date('2026-10-27T14:00:00.000Z'),
      'capture',
    );

    expect(result.status).toBe('waiting_window');
    expect(result.nextAttemptAt).toBeTruthy();
  });
});
