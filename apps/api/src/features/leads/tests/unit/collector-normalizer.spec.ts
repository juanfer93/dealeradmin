import { describe, expect, it } from 'vitest';
import { normalizeCollectorInput } from '../../domain/collector-normalizer';

describe('normalizeCollectorInput', () => {
  it('normalizes dollar, plain-number, and k down-payment formats', () => {
    expect(normalizeCollectorInput({ message: 'I can put 1K down' }).down_payment).toBe('1000');
    expect(normalizeCollectorInput({ message: 'down payment is $1,000' }).down_payment).toBe('1000');
    expect(normalizeCollectorInput({ message: 'I have 1000 for down' }).down_payment).toBe('1000');
  });

  it('preserves the vehicle description and identifies the purchase timeline', () => {
    const result = normalizeCollectorInput({ message: 'I want a Toyota RAV4 SUV this week' });
    expect(result.vehicle_type).toContain('Toyota RAV4 SUV');
    expect(result.purchase_timeline).toBe('this week');
  });

  it('stores document answers as structured text and proposes the next question', () => {
    const result = normalizeCollectorInput({ message: 'Yes, I have my ID' });
    expect(result.documents).toContain('identification: yes');
    expect(result.has_identification).toBe('yes');
    expect(result.next_question).toBe('Do you have proof of income?');
  });

  it('keeps existing memory and does not erase valid fields with an empty reply', () => {
    const result = normalizeCollectorInput({
      message: '',
      vehicle_type: 'SUV',
      down_payment: '1500',
      qualification_memory: 'vehicle: SUV; down payment: 1500',
    });
    expect(result.vehicle_type).toBe('SUV');
    expect(result.down_payment).toBe('1500');
    expect(result.qualification_memory).toContain('vehicle: SUV');
  });
});
