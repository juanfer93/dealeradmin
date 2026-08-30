import { describe, expect, it } from 'vitest';
import { normalizeGhlOutboundPayload } from '../../application/ghl-outbound-payload';

describe('normalizeGhlOutboundPayload', () => {
  it('adapts native HighLevel contact data and customData to the API contract', () => {
    const result = normalizeGhlOutboundPayload({
      id: 'contact-123',
      locationId: 'location-123',
      first_name: 'Alexander',
      last_name: 'Freez',
      phone: '+13215550199',
      location: { id: 'location-123', name: 'Easterns Automotive Group' },
      customData: {
        vehicle_interest: 'truck',
        down_payment: '$1,500',
        identification: 'ID',
        documents_available: 'proof of income',
        purchase_timeline: 'this week',
        easterns_zone: 'Baltimore',
        easterns_dealer_selected: 'true',
      },
    }) as Record<string, any>;

    expect(result).toMatchObject({
      event_type: 'lead.ready_for_whatsapp',
      dealer_name: 'Easterns Automotive Group',
      ghl_location_id: 'location-123',
      ghl_contact_id: 'contact-123',
      lead: {
        name: 'Alexander Freez',
        phone: '+13215550199',
        vehicle_type: 'truck',
        down_payment: '$1,500',
        identification: 'ID',
        documents: 'proof of income',
        purchase_timeline: 'this week',
        easterns_zone: 'Baltimore',
        easterns_dealer_selected: true,
      },
    });
  });

  it('keeps the internal contract unchanged', () => {
    const payload = {
      event_id: 'evt-1',
      event_type: 'lead.ready_for_whatsapp',
      occurred_at: '2026-08-29T00:00:00.000Z',
      dealer_id: 'STAFFORD',
      dealer_name: 'Offlease Motors Stafford',
      ghl_location_id: 'location-1',
      ghl_contact_id: 'contact-1',
      lead: { name: 'Test Lead', phone: '+13215550100' },
    };

    expect(normalizeGhlOutboundPayload(payload)).toBe(payload);
  });
});
