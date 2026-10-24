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
});
