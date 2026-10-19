import { describe, expect, it } from 'vitest';
import { dealerIdentity, formatLeadCopy, formatLeadListCopy, formatLeadMessage, formatPurchaseTimelineLabel, formatQualificationLabels } from './OperatorDashboard';

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
  it('rounds 999 and hides insufficient down payments in the UI and copied text', () => {
    const base = {
      id: '1', dealerId: 'd', name: 'Lead', phone: '+15550001111', vehicleType: 'SUV',
      identification: null, bankAccount: null, documents: null, purchaseTimeline: null,
      status: 'pending' as const, messageText: '', createdAt: '2026-09-15T12:00:00.000Z',
    };
    expect(formatLeadMessage({ ...base, dealerName: 'Dealer', downPayment: '999' })).toContain('1000 de down');
    expect(formatLeadCopy({ ...base, dealerName: 'Dealer', downPayment: '850', messageText: 'Lead +15550001111 SUV, 850 de down.' })).not.toContain('850');
    expect(formatLeadCopy({ ...base, dealerName: 'Offlease Fredericksburg', downPayment: '1200', messageText: 'Lead +15550001111 SUV, 1200 de down.' })).not.toContain('1200');
  });

  it.each([
    'Dependiendo de los Precios',
    'Me Puede Enviar Fotos',
    'Me Puede Mandar Fotos',
  ])('always uses the current lead name in copied text when the stored prefix is "%s"', (storedName) => {
    expect(formatLeadCopy({
      id: '1', dealerId: 'd', dealerName: 'Stafford', name: 'Edwin', phone: '+18572006717', vehicleType: 'suv',
      downPayment: '1000', identification: null, bankAccount: null, documents: null, purchaseTimeline: null,
      status: 'pending', messageText: `${storedName} +18572006717 suv, 1000 de down.`, createdAt: '2026-09-15T12:00:00.000Z',
    })).toBe('Edwin +18572006717 suv.');
  });

  it('preserves the stored copy details after replacing only its stale name prefix', () => {
    expect(formatLeadCopy({
      id: '1', dealerId: 'd', dealerName: 'Stafford', name: 'Reyna Lizeth Rodriguez Ochoa', phone: '+15716913409', vehicleType: 'Nissan Altima',
      downPayment: '3500', identification: null, bankAccount: null, documents: null, purchaseTimeline: 'lo más pronto posible',
      status: 'pending', messageText: 'Me Puede Enviar Fotos +15716913409 Nissan Altima, 3500 de down, quiere comprar lo más pronto posible.', createdAt: '2026-09-15T12:00:00.000Z',
    })).toBe('Reyna Lizeth Rodriguez Ochoa +15716913409 Nissan Altima, 3500 de down, quiere comprar lo más pronto posible.');
  });

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

describe('lead list copy formatting', () => {
  const lead = (id: string, name: string) => ({
    id, dealerId: 'd', dealerName: 'Dealer', name, phone: `+1555000${id}`,
    vehicleType: 'SUV', identification: null, bankAccount: null, documents: null,
    purchaseTimeline: null, status: 'pending' as const, messageText: `${name} ${id}.`,
    createdAt: '2026-09-15T12:00:00.000Z',
  });

  it('separates three leads with a blank line', () => {
    expect(formatLeadListCopy([lead('1', 'Ana'), lead('2', 'Luis'), lead('3', 'Marta')], (item) => item.messageText))
      .toBe('Ana 1.\n\nLuis 2.\n\nMarta 3.');
  });

  it('keeps a single lead without a trailing blank line', () => {
    expect(formatLeadListCopy([lead('1', 'Ana')], (item) => item.messageText)).toBe('Ana 1.');
  });

  it('returns an empty string for empty or null input', () => {
    expect(formatLeadListCopy([])).toBe('');
    expect(formatLeadListCopy(null)).toBe('');
  });
});
