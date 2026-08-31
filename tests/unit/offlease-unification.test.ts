import { describe, expect, it } from 'vitest';
import {
  applyTestWebhookLead,
  getTestDealer,
  OFFLEASE_FREDERICKSBURG_LOCATION_IDS,
  testDealers,
  testLead,
} from '../../apps/api/src/features/leads/application/test-lead-store';

describe('unified Offlease Fredericksburg dealer', () => {
  it('exposes one canonical Fredericksburg dealer and resolves the retired id to it', () => {
    expect(testDealers.filter((dealer) => dealer.code.startsWith('FRED'))).toHaveLength(1);
    expect(getTestDealer('dealer-fredericksburg-2')?.id).toBe('dealer-fredericksburg');
  });

  it('accepts both registered GHL locations into the canonical queue', () => {
    const original = { ...testLead };
    const payload = {
      event_id: `offlease-alias-${Date.now()}`,
      event_type: 'lead.created',
      occurred_at: new Date().toISOString(),
      dealer_id: 'FRED-2',
      ghl_location_id: OFFLEASE_FREDERICKSBURG_LOCATION_IDS.alias,
      ghl_contact_id: 'contact-offlease-alias',
      dealer_name: 'Off Lease Motors Fredericksburg 2',
      lead: { name: original.name, phone: original.phone, vehicle_type: original.vehicleType },
    };

    expect(applyTestWebhookLead(payload)).toBe(true);
    expect(testLead.dealerId).toBe('dealer-fredericksburg');
  });
});
