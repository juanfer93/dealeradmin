import { describe, expect, it } from 'vitest';
import { normalizeDownPayment } from '../../domain/down-payment';
import { buildWhatsAppMessage } from '../../domain/message-builder';

describe('normalización de pago inicial', () => {
  it.each(['cash', 'Cash', 'contado', 'de contado', 'efectivo', 'paid in full'])('guarda %s como Cash', (value) => {
    expect(normalizeDownPayment(value)).toBe('Cash');
  });

  it('preserva un down payment monetario', () => {
    expect(normalizeDownPayment('$3,500')).toBe('$3,500');
  });

  it('explica el pago en efectivo en el mensaje operativo', () => {
    expect(buildWhatsAppMessage('Ana Perez', '+15550000000', { down_payment: 'pagará de contado' })).toContain('paga en cash');
  });

  it('mantiene el resumen en inglés cuando la cualificación llega en inglés', () => {
    expect(buildWhatsAppMessage('Alexander Freez', '3212343212', {
      vehicle_type: 'truck',
      down_payment: '$1,500',
      identification: 'ID-123',
      documents: 'proof of income',
      purchase_timeline: 'this week',
    })).toBe('Alexander Freez 3212343212 truck, $1,500 down, ID ID-123, proof of income, wants to buy this week.');
  });
});
