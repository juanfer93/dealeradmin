import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GhlConversationContextService } from '../../application/ghl-conversation-context.service';

function createService(results: unknown[][]) {
  const query = vi.fn<(sql: string, parameters: unknown[]) => Promise<unknown[]>>(async (sql) =>
    sql.includes('FROM invalid_real_names') ? [{ normalized_value: 'estoy entre ambos' }] : results.shift() ?? []);
  return { service: new GhlConversationContextService({ query } as never), query };
}

const input = { locationId: 'stafford-location', contactId: 'contact-a', conversationId: 'conversation-new', channel: 'whatsapp' as const };

describe('GhlConversationContextService', () => {
  it('merges normalized context from the exact conversation and its same-channel siblings', async () => {
    const { service, query } = createService([
      [{ id: 'dealer-stafford' }],
      [{ id: 'lead-a', first_name: 'Ana', last_name: 'Lopez' }],
      [{ vehicle_type: 'SUV', down_payment: null, purchase_timeline: 'this month', documents: null }],
      [
        {
          id: 'lead-a', ghl_conversation_id: 'conversation-new', conversation_match: true,
          qualification_snapshot: { real_name: 'Ana Lopez', vehicle_type: '', down_payment: '4500', purchase_timeline: '', documents: '', assigned_dealer_id: 'dealer-stafford' },
          last_message_at: '2026-11-09T12:00:00.000Z', latest_inbound_at: '2026-11-09T12:00:00.000Z',
        },
        {
          id: 'lead-a', ghl_conversation_id: 'conversation-old', conversation_match: false,
          qualification_snapshot: { real_name: 'Ana Lopez', vehicle_type: 'Sedan', down_payment: '', purchase_timeline: '', documents: 'yes', assigned_dealer_id: 'dealer-stafford' },
          last_message_at: '2026-11-09T11:00:00.000Z', latest_inbound_at: '2026-11-09T11:00:00.000Z',
        },
      ],
    ]);

    await expect(service.getContext(input, new Date('2026-11-09T12:01:00.000Z'))).resolves.toEqual({
      ok: true,
      source: 'dealeradmin',
      known: { customer_name: 'Ana Lopez', vehicle_type: 'Sedan', vehicle_intent: null, down_payment: '4500', purchase_timeline: 'this month', documents: 'yes' },
      missing: [],
      nextQuestion: null,
      contextStatus: 'fresh',
      contextUpdatedAt: '2026-11-09T12:00:00.000Z',
    });
    expect(query.mock.calls[3]?.[0]).toContain('c.ghl_location_id = $2');
    expect(query.mock.calls[3]?.[0]).toContain('c.ghl_contact_id = $3');
    expect(query.mock.calls[3]?.[0]).toContain('c.channel = $4');
  });

  it('does not promote invalid names or invent missing facts when no conversation evidence exists', async () => {
    const { service } = createService([
      [{ id: 'dealer-stafford' }],
      [{ id: 'lead-a', first_name: 'Estoy Entre Ambos', last_name: null }],
      [{ vehicle_type: null, down_payment: null, purchase_timeline: null, documents: null }],
      [],
    ]);

    await expect(service.getContext(input)).resolves.toMatchObject({
      known: { customer_name: null, vehicle_type: null, vehicle_intent: null, down_payment: null, purchase_timeline: null, documents: null },
      missing: ['customer_name', 'vehicle_type', 'down_payment', 'purchase_timeline', 'documents'],
      nextQuestion: 'customer_name',
      contextStatus: 'unknown',
      contextUpdatedAt: null,
    });
  });

  it('uses the WhatsApp profile display name as fallback when the real-name phrase is invalid', async () => {
    const { service } = createService([
      [{ id: 'dealer-stafford' }],
      [{ id: 'lead-a', first_name: 'Estoy', last_name: 'Entre Ambos' }],
      [{ vehicle_type: null, down_payment: null, purchase_timeline: null, documents: null }],
      [{
        id: 'lead-a', ghl_conversation_id: 'conversation-new', conversation_match: true,
        qualification_snapshot: { real_name: 'Estoy Entre Ambos', profile_name: 'wa_handle_312', assigned_dealer_id: 'dealer-stafford' },
        last_message_at: '2026-11-09T12:00:00.000Z', latest_inbound_at: '2026-11-09T12:00:00.000Z',
      }],
    ]);

    await expect(service.getContext(input)).resolves.toMatchObject({ known: { customer_name: 'wa_handle_312' } });
  });

  it('keeps known answers available while marking an old inbound snapshot stale', async () => {
    const { service } = createService([
      [{ id: 'dealer-stafford' }],
      [{ id: 'lead-a', first_name: 'Ana', last_name: 'Lopez' }],
      [{ vehicle_type: null, down_payment: null, purchase_timeline: null, documents: null }],
      [{ id: 'lead-a', ghl_conversation_id: 'conversation-old', conversation_match: false, qualification_snapshot: { vehicle_type: 'SUV', assigned_dealer_id: 'dealer-stafford' }, last_message_at: '2026-11-09T10:00:00.000Z', latest_inbound_at: '2026-11-09T10:00:00.000Z' }],
    ]);

    await expect(service.getContext(input, new Date('2026-11-09T11:00:00.000Z'))).resolves.toMatchObject({
      known: { customer_name: 'Ana Lopez', vehicle_type: 'SUV', vehicle_intent: null },
      missing: ['down_payment', 'purchase_timeline', 'documents'],
      contextStatus: 'stale',
    });
  });

  it('returns seller intent to the bot without adding a new missing-field question', async () => {
    const { service } = createService([
      [{ id: 'dealer-arlington' }],
      [{ id: 'lead-a', first_name: 'Carlos', last_name: 'Inzunza' }],
      [{ vehicle_type: 'Tacoma 2021', down_payment: null, purchase_timeline: null, documents: null }],
      [{
        id: 'lead-a', ghl_conversation_id: 'conversation-new', conversation_match: true,
        qualification_snapshot: { real_name: 'Carlos Inzunza', vehicle_type: 'Tacoma 2021', vehicle_intent: 'sell', assigned_dealer_id: 'dealer-arlington' },
        last_message_at: '2026-11-09T12:00:00.000Z', latest_inbound_at: '2026-11-09T12:00:00.000Z',
      }],
    ]);

    await expect(service.getContext(input, new Date('2026-11-09T12:01:00.000Z'))).resolves.toMatchObject({
      known: { vehicle_type: 'Tacoma 2021', vehicle_intent: 'sell' },
      missing: ['down_payment', 'purchase_timeline', 'documents'],
      nextQuestion: 'down_payment',
    });
  });

  it('returns no context for an unknown contact and does not read another dealer record', async () => {
    const { service, query } = createService([[{ id: 'dealer-stafford' }], []]);

    await expect(service.getContext(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns no context for an unauthorized GHL location', async () => {
    const { service, query } = createService([[]]);

    await expect(service.getContext(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails closed without leaking database details when storage is unavailable', async () => {
    const query = vi.fn().mockRejectedValue(new Error('private database detail'));
    const service = new GhlConversationContextService({ query } as never);

    await expect(service.getContext(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
