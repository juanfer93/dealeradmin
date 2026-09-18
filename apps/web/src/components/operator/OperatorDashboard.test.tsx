import { describe, expect, it } from 'vitest';
import { dealerIdentity, formatLeadMessage, formatPurchaseTimelineLabel, formatQualificationLabels } from './OperatorDashboard';

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

describe('operator qualification message normalization', () => {
  it('hides affirmative yes values and localizes an urgent Spanish timeline', () => {
    const message = formatLeadMessage({
      id: '1', dealerId: 'd', dealerName: 'Stafford', name: 'Luis', phone: '+19196497529', vehicleType: 'Toyota Tacoma',
      downPayment: 'cash', identification: 'yes', bankAccount: 'yes', documents: 'identification: yes; proof of income: yes',
      purchaseTimeline: 'hoy', status: 'pending', messageText: '', createdAt: '2026-09-15T12:00:00.000Z',
    }, 'es');

    expect(message).toContain('cuenta bancaria');
    expect(message).toContain('quiere comprar lo más pronto posible');
    expect(message).not.toMatch(/(?:ID|cuenta bancaria|proof of income|prueba de ingresos|comprobante de ingresos):?\s+yes/i);
  });

  it('normalizes the advisor-facing timeline in the lead tags', () => {
    expect(formatPurchaseTimelineLabel('Wants to buy today', 'es')).toBe('wants to buy asap');
    expect(formatPurchaseTimelineLabel('hoy', 'es')).toBe('quiere comprar lo más pronto posible');
    expect(formatPurchaseTimelineLabel('quiere comprar explorando opciones', 'es')).toBe('Quiere ver opciones');
    expect(formatPurchaseTimelineLabel('Quiere ver opciones', 'en')).toBe('wants to see options');
  });

  it('omits an explicit negative down payment from advisor-facing copy', () => {
    expect(formatLeadMessage({
      id: '1', dealerId: 'd', dealerName: 'Stafford', name: 'Ana', phone: '+15550000000', vehicleType: 'SUV',
      downPayment: 'No down payment', identification: null, bankAccount: null, documents: null,
      purchaseTimeline: 'Quiere ver opciones', status: 'pending', messageText: '', createdAt: '2026-09-15T12:00:00.000Z',
    }, 'es')).toBe('Ana +15550000000 SUV, Quiere ver opciones.');
  });
});
