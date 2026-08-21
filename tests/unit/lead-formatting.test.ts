import { describe, expect, it } from 'vitest';
import { buildWhatsAppMessage } from '../../apps/api/src/features/leads/domain/message-builder';
import { normalizePhone } from '../../apps/api/src/features/leads/domain/phone-normalizer';

describe('lead formatting', () => {
  it('normalizes US phone variants to E.164', () => {
    expect(normalizePhone('555-987-6543')).toBe('+15559876543');
    expect(normalizePhone('+1 555 123 4567')).toBe('+15551234567');
  });

  it('builds a clean complete message', () => {
    expect(buildWhatsAppMessage('Carlos Mendoza', '+15551234567', {
      vehicle_type: 'SUV',
      down_payment: '$2,000',
      purchase_timeline: 'Esta semana',
      documents: 'ID y prueba de ingresos',
    })).toBe('Carlos Mendoza +15551234567 SUV, $2,000 de down, ID y prueba de ingresos, quiere comprar esta semana.');
  });

  it('uses empty strings for missing optional values', () => {
    const message = buildWhatsAppMessage('Maria Lopez', '+15559876543', {
      vehicle_type: 'Sedan',
      down_payment: null,
      purchase_timeline: '',
      documents: null,
    });
    expect(message).toBe('Maria Lopez +15559876543 Sedan.');
    expect(message).not.toContain('no indicado');
  });

  it('accepts omitted optional fields and keeps them empty', () => {
    expect(buildWhatsAppMessage('Alex Rivera', '+15550001111', {})).toBe('Alex Rivera +15550001111.');
  });
});
