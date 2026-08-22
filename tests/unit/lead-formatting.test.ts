import { describe, expect, it } from 'vitest';
import { buildWhatsAppMessage, normalizePurchaseTimeline } from '../../apps/api/src/features/leads/domain/message-builder';
import { normalizePhone } from '../../apps/api/src/features/leads/domain/phone-normalizer';

describe('lead formatting', () => {
  it('normalizes US phone variants to E.164', () => {
    expect(normalizePhone('555-987-6543')).toBe('+15559876543');
    expect(normalizePhone('+1 555 123 4567')).toBe('+15551234567');
  });

  it('preserves explicit foreign country codes while normalizing punctuation', () => {
    expect(normalizePhone('+44 (20) 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('00 57 300 123 4567')).toBe('+573001234567');
  });

  it('builds a clean complete message', () => {
    expect(buildWhatsAppMessage('Carlos Mendoza', '+15551234567', {
      vehicle_type: 'SUV',
      down_payment: '$2,000',
      identification: 'A1234567',
      bank_account: 'Chase',
      purchase_timeline: 'Esta semana',
    })).toBe('Carlos Mendoza +15551234567 SUV, $2,000 de down, ID A1234567, cuenta bancaria Chase, quiere comprar esta semana.');
  });

  it('replaces only-looking answers with the operator-facing options label', () => {
    expect(normalizePurchaseTimeline('Solo estoy mirando')).toBe('Quiere ver opciones');
    expect(normalizePurchaseTimeline('just browsing')).toBe('Quiere ver opciones');
    expect(buildWhatsAppMessage('Carlos Mendoza', '+15551234567', {
      vehicle_type: 'Troca',
      purchase_timeline: 'solo viendo opciones',
    })).toBe('Carlos Mendoza +15551234567 Troca, Quiere ver opciones.');
  });

  it('uses empty strings for missing optional values', () => {
    const message = buildWhatsAppMessage('Maria Lopez', '+15559876543', {
      vehicle_type: 'Sedan',
      down_payment: null,
      purchase_timeline: '',
    });
    expect(message).toBe('Maria Lopez +15559876543 Sedan.');
    expect(message).not.toContain('no indicado');
  });

  it('accepts omitted optional fields and keeps them empty', () => {
    expect(buildWhatsAppMessage('Alex Rivera', '+15550001111', {})).toBe('Alex Rivera +15550001111.');
  });

  it('omits missing ordered fields instead of copying placeholders', () => {
    expect(buildWhatsAppMessage('Sam Lee', '+442079460958', {
      vehicle_type: 'Sedan',
      bank_account: 'Barclays',
    })).toBe('Sam Lee +442079460958 Sedan, cuenta bancaria Barclays.');
  });
});
