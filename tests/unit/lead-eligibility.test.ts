import { describe, expect, it } from 'vitest';
import { evaluateLeadEligibility } from '../../apps/api/src/features/webhooks/domain/lead-eligibility';

describe('evaluateLeadEligibility', () => {
  it('accepts a lead with the required routing facts', () => {
    expect(evaluateLeadEligibility({ phone: '+15551234567', dealerId: 'dealer-1', ghlLocationId: 'loc-1', dealerActive: true })).toEqual({ eligible: true, reasons: [] });
  });

  it('rejects a lead without a phone and preserves actionable reasons', () => {
    expect(evaluateLeadEligibility({ dealerId: 'dealer-1', ghlLocationId: 'loc-1', dealerActive: true })).toEqual({ eligible: false, reasons: ['PHONE_REQUIRED'] });
  });

  it('rejects inactive or incomplete routing targets', () => {
    expect(evaluateLeadEligibility({ phone: '555', dealerActive: false })).toEqual({ eligible: false, reasons: ['DEALER_REQUIRED', 'GHL_LOCATION_REQUIRED', 'DEALER_INACTIVE'] });
  });
});
