import { describe, expect, it } from 'vitest';
import { dealerIdentity } from './OperatorDashboard';

describe('dealerIdentity', () => {
  it('keeps Koons dealer names out of the Offlease group', () => {
    expect(dealerIdentity('Koons de Fredericksburg')).toEqual({
      group: 'Koons de Fredericksburg',
      location: 'Fredericksburg',
    });
    expect(dealerIdentity('Koons Automotive of Fredericksburg')).toEqual({
      group: 'Koons Automotive of Fredericksburg',
      location: 'Fredericksburg',
    });
    expect(dealerIdentity('Koons Automotive of Culpeper')).toEqual({
      group: 'Koons Automotive of Culpeper',
      location: 'Culpeper',
    });
  });

  it('preserves the existing Offlease presentation', () => {
    expect(dealerIdentity('Offlease Motors Stafford')).toEqual({
      group: 'Offlease Motors',
      location: 'Stafford',
    });
  });
});
