import { describe, expect, it, vi } from 'vitest';
import { ConversationQualificationFunctions } from '../../application/functions/conversation-qualification.functions';

describe('ConversationQualificationFunctions', () => {
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
