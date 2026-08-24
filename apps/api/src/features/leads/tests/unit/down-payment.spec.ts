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
});
