import { describe, expect, it, vi } from 'vitest';
import { ConversationQualificationFunctions } from '../../application/functions/conversation-qualification.functions';

describe('ConversationQualificationFunctions', () => {
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
