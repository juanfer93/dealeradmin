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
        down_payment: '1500',
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
        down_payment: '1500',
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

  it('reads nested custom fields and normalizes a partial GHL payload from memory', () => {
    const result = normalizeGhlOutboundPayload({
      id: 'contact-456',
      locationId: 'location-456',
      first_name: 'Jamie',
      last_name: 'Rojas',
      phone: '787-232-7024',
      contact: {
        customFields: {
          qualification_memory: 'vehicle: Suv',
        },
      },
      customData: { message_body: '2,000' },
    }) as Record<string, any>;

    expect(result.lead).toMatchObject({
      name: 'Jamie Rojas',
      down_payment: '2000',
      vehicle_type: 'Suv',
      qualification_memory: expect.stringContaining('down payment: 2000'),
    });
  });

  it('drops a phone accidentally received in the GHL down payment field', () => {
    const result = normalizeGhlOutboundPayload({
      id: 'contact-phone-as-down',
      locationId: 'location-phone-as-down',
      first_name: 'Phone',
      last_name: 'Test',
      phone: '3019876543',
      customData: { down_payment: '3019876543' },
    }) as Record<string, any>;

    expect(result.lead.down_payment).toBe('');
  });

  it.each([
    {
      name: 'custom fields complete',
      payload: {
        id: 'qa-custom-fields',
        locationId: 'easterns-qa-location',
        first_name: 'QA',
        last_name: 'Custom Fields',
        phone: '',
        customData: {
          vehicle_type: 'SUV',
          down_payment: '$2,000',
          identification: 'yes',
          documents: 'ID and proof of income',
          purchase_timeline: 'today',
          message: 'I want a Toyota RAV4',
        },
      },
      expected: {
        qualification_source: 'custom_fields',
        qualification_complete: true,
        vehicle_type: 'Toyota RAV4',
        down_payment: '2000',
        purchase_timeline: 'today',
      },
    },
    {
      name: 'qualification memory complete with custom fields empty',
      payload: {
        id: 'qa-memory-only',
        locationId: 'easterns-qa-location',
        first_name: 'QA',
        last_name: 'Memory Only',
        phone: '',
        contact: {
          customFields: {
            qualification_memory: 'vehicle_type: SUV; make: Toyota; model: RAV4; down payment: trade-in + 2K; documents: ID and proof of income; purchase_timeline: in 2 weeks',
            vehicle_type: '',
            down_payment: '',
            identification: '',
            documents: '',
            purchase_timeline: '',
          },
        },
        message: 'QA conversation captured in qualification memory',
      },
      expected: {
        qualification_source: 'qualification_memory',
        qualification_complete: true,
        vehicle_type: 'SUV — Toyota RAV4',
        down_payment: '2000 + trade-in',
        purchase_timeline: 'in 2 weeks',
      },
    },
    {
      name: 'memory wins when custom fields are partially filled',
      payload: {
        id: 'qa-memory-precedence',
        locationId: 'easterns-qa-location',
        first_name: 'QA',
        last_name: 'Memory Precedence',
        phone: '',
        customData: {
          vehicle_type: 'Sedan',
          down_payment: '',
          identification: 'yes',
          documents: '',
          purchase_timeline: '',
        },
        contact: {
          customFields: {
            qualification_memory: 'vehicle: SUV; make: Honda; model: CR-V; down payment: $1,500 and I want to change my vehicle; documents: driver license and proof of income; timeline: this month',
          },
        },
      },
      expected: {
        qualification_source: 'both',
        qualification_complete: true,
        vehicle_type: 'SUV — Honda CR-V',
        down_payment: '1500 + trade-in',
        purchase_timeline: 'this month',
      },
    },
  ])('$name', ({ payload, expected }) => {
    const result = normalizeGhlOutboundPayload(payload) as Record<string, any>;
    expect(result.ghl_location_id).toBe('easterns-qa-location');
    expect(result.lead).toMatchObject(expected);
  });
});
