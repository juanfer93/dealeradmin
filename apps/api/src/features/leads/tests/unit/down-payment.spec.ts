import { describe, expect, it } from 'vitest';
import { classifyVehicle, evaluateDownPayment, hasRequiredDownPayment, isNoDownPayment, normalizeDownPayment } from '../../domain/down-payment';
import { buildWhatsAppMessage } from '../../domain/message-builder';

describe('normalización de pago inicial', () => {
  it.each(['cash', 'Cash', 'contado', 'de contado', 'efectivo', 'paid in full'])('guarda %s como Pagara en cash / de contado', (value) => {
    expect(normalizeDownPayment(value)).toBe('Pagara en cash / de contado');
  });

  it('preserva un down payment monetario', () => {
    expect(normalizeDownPayment('$3,500')).toBe('$3,500');
    expect(evaluateDownPayment('Sedan', '1.500')).toMatchObject({ amount: 1500, meetsMinimum: true });
  });

  it.each(['No tengo down payment', "I don't have a down payment", 'sin enganche'])('preserva la evidencia negativa %s en BD, pero no en el texto copiado', (value) => {
    expect(isNoDownPayment(value)).toBe(true);
    expect(normalizeDownPayment(value)).toBe('No down payment');
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', { down_payment: value })).toBe('Ana Perez +15550000000.');
  });

  it('explica el pago en efectivo en el mensaje operativo', () => {
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', { down_payment: 'pagará de contado' })).toContain('Pagara en cash / de contado');
  });

  it('mantiene el resumen en inglés cuando la cualificación llega en inglés', () => {
    expect(buildWhatsAppMessage('Alexander Freez', '3212343212', {
      vehicle_type: 'truck',
      down_payment: '$1,500',
      identification: 'ID-123',
      documents: 'proof of income',
      purchase_timeline: 'this week',
    })).toBe('Alexander Freez 3212343212 truck, $1,500 down, ID: ID-123, proof of income, wants to buy this week.');
  });

  it('muestra ID y cuenta bancaria sin valores booleanos y normaliza compra urgente en español', () => {
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', {
      vehicle_type: 'SUV',
      identification: 'yes',
      bank_account: 'yes',
      purchase_timeline: 'hoy',
    })).toBe('Ana Perez +15550000000 SUV, ID, cuenta bancaria, quiere comprar lo más pronto posible.');
  });

  it('mantiene el idioma explícito de la frase de compra aunque otros datos estén mezclados', () => {
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', {
      vehicle_type: 'SUV',
      purchase_timeline: 'quiere comprar this week',
    })).toContain('quiere comprar esta semana');
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', {
      vehicle_type: 'SUV',
      purchase_timeline: 'wants to buy esta semana',
    })).toContain('wants to buy this week');
  });

  it.each(['solo estoy mirando', 'solo estoy observando', 'solo estoy viendo'])('convierte %s en opciones', (timeline) => {
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', {
      purchase_timeline: timeline,
    })).toBe('Ana Perez +15550000000, Quiere ver opciones.');
  });

  it('oculta identificaciones negativas y documentos negativos', () => {
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', {
      identification: 'no',
      bank_account: 'no',
      documents: 'identification: no; proof of income: no',
    })).toBe('Ana Perez +15550000000.');
  });

  it.each([
    ['Sedan', 'sedan', 1500],
    ['Honda Civic', 'sedan', 1500],
    ['Toyota Corolla', 'sedan', 1500],
    ['Chevrolet Camaro', 'luxury_sedan', 2000],
    ['Dodge Challenger', 'luxury_sedan', 2000],
    ['Mercedes C300 sedan', 'luxury_sedan', 2000],
    ['Toyota Highlander', 'suv_or_van', 2000],
    ['Honda Odyssey van', 'suv_or_van', 2000],
    ['Toyota Tacoma', 'truck', 3000],
  ] as const)('clasifica %s y exige $%s', (vehicle, category, minimum) => {
    expect(classifyVehicle(vehicle)).toBe(category);
    expect(evaluateDownPayment(vehicle, String(minimum)).minimum).toBe(minimum);
    expect(hasRequiredDownPayment(vehicle, String(minimum))).toBe(true);
    expect(hasRequiredDownPayment(vehicle, String(minimum - 1))).toBe(false);
  });

  it('acepta trade-in solo o combinado con efectivo en Offlease', () => {
    expect(hasRequiredDownPayment('Toyota Tacoma', 'trade-in')).toBe(true);
    expect(hasRequiredDownPayment('Toyota Tacoma', '2000 + trade-in')).toBe(true);
    expect(hasRequiredDownPayment('Toyota Tacoma', '3000 + trade-in')).toBe(true);
    expect(hasRequiredDownPayment('Toyota Tacoma', '2000')).toBe(false);
  });

  it('allows $1000 or more when the Offlease financing-history rule is enabled', () => {
    expect(evaluateDownPayment('Toyota Tacoma', '1000')).toMatchObject({ amount: 1000, meetsMinimum: false });
    expect(evaluateDownPayment('Toyota Tacoma', '1000', { allowPromotionalThousand: true })).toMatchObject({ amount: 1000, meetsMinimum: true });
    expect(evaluateDownPayment('Toyota Tacoma', '1500', { allowPromotionalThousand: true })).toMatchObject({ amount: 1500, meetsMinimum: true });
    expect(evaluateDownPayment('Toyota Tacoma', '999', { allowPromotionalThousand: true })).toMatchObject({ amount: 999, meetsMinimum: false });
  });
});
