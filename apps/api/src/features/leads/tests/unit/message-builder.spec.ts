import { describe, expect, it } from 'vitest';
import { buildWhatsAppMessage } from '../../domain/message-builder';

describe('qualification message normalization', () => {
  it('renders affirmative document evidence as labels instead of yes values', () => {
    const message = buildWhatsAppMessage('Luis', '+19196497529', {
      vehicle_type: 'Toyota Tacoma',
      down_payment: 'cash',
      identification: 'yes',
      bank_account: 'yes',
      documents: 'identification: yes; proof of income: yes',
      purchase_timeline: 'hoy',
    });

    expect(message).toContain('ID');
    expect(message).toContain('cuenta bancaria');
    expect(message).toContain('comprobante de ingresos');
    expect(message).toContain('quiere comprar lo más pronto posible');
    expect(message).not.toMatch(/(?:ID|identification|cuenta bancaria|bank account|proof of income|prueba de ingresos|comprobante de ingresos):?\s+yes/i);
  });

  it('uses the requested English ASAP wording and keeps the language consistent', () => {
    const message = buildWhatsAppMessage('Jason', '+18045550123', {
      vehicle_type: 'Toyota Tacoma',
      down_payment: '2000',
      bank_account: 'yes',
      purchase_timeline: 'Wants to buy today',
    });

    expect(message).toContain('wants to buy asap');
    expect(message).toContain('bank account');
    expect(message).not.toContain('quiere comprar');
    expect(message).not.toContain('bank account yes');
  });

  it.each([
    ['exploring options', 'wants to see options'],
    ['wants to buy exploring options', 'wants to see options'],
    ['quiere comprar explorando opciones', 'Quiere ver opciones'],
    ['quiere comprar quiere ver opciones', 'Quiere ver opciones'],
  ])('renders only-looking intent without a purchase prefix: %s', (purchase_timeline, expected) => {
    const message = buildWhatsAppMessage('Lead', '+15550001111', { purchase_timeline });
    expect(message).toContain(expected);
    expect(message).not.toContain('wants to buy exploring options');
    expect(message).not.toContain('quiere comprar quiere ver opciones');
  });

  it.each([
    ['No tengo down payment', 'Lead +15550001111.'],
    ["I don't have a down payment", 'Lead +15550001111.'],
  ])('omits an explicit negative down payment from copied text: %s', (down_payment, expected) => {
    expect(buildWhatsAppMessage('Lead', '+15550001111', { down_payment })).toBe(expected);
  });
});
