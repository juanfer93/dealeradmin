import { describe, expect, it } from 'vitest';
import { dealerIdentity, formatQualificationLabels } from './OperatorDashboard';

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

describe('formatQualificationLabels', () => {
  it('does not render proof of income when its normalized value is negative', () => {
    expect(formatQualificationLabels({ identification: 'yes', documents: 'identification: yes; proof of income: no' }, 'es')).toEqual({
      identification: 'ID',
      documents: '',
    });
  });

  it('combines positive identification and income evidence into one label', () => {
    expect(formatQualificationLabels({ identification: 'yes', documents: 'identification: yes; proof of income: yes' }, 'es')).toEqual({
      identification: '',
      documents: 'ID y prueba de ingresos',
    });
  });
});
