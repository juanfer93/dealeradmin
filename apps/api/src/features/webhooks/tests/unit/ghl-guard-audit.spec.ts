import { describe, expect, it } from 'vitest';
import { completedFieldsBetween, type GhlGuardLeadMetadata } from '../../application/ghl-guard-audit';

const metadata = (overrides: Partial<GhlGuardLeadMetadata> = {}): GhlGuardLeadMetadata => ({
  lead: { canonical_phone: '', first_name: 'Ana' },
  qualification: { vehicle_type: '', down_payment: '1000' },
  location: null,
  dealer_relations: [{ dealer_id: 'dealer-1', vehicle_type: '', down_payment: '1000' }],
  ...overrides,
});

describe('GHL guard audit details', () => {
  it('records only blank-to-filled fields', () => {
    expect(completedFieldsBetween(
      metadata(),
      metadata({
        lead: { canonical_phone: '+13015550123', first_name: 'Ana' },
        qualification: { vehicle_type: 'Ram 2500', down_payment: '2000' },
        location: null,
        dealer_relations: [{ dealer_id: 'dealer-1', vehicle_type: 'Ram 2500', down_payment: '1000' }],
      }),
    )).toEqual({
      'lead.canonical_phone': { before: '', after: '+13015550123', source: 'ghl_guard' },
      'qualification.vehicle_type': { before: '', after: 'Ram 2500', source: 'ghl_guard' },
      'dealer_relations[0].vehicle_type': { before: '', after: 'Ram 2500', source: 'ghl_guard' },
    });
  });

  it('returns null when the guard did not recover anything', () => {
    const same = metadata();
    expect(completedFieldsBetween(same, same)).toBeNull();
    expect(completedFieldsBetween(null, same)).toBeNull();
  });
});
