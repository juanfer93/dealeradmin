import { describe, expect, it } from 'vitest';
import { normalizeCollectorInput } from '../../domain/collector-normalizer';

describe('normalizeCollectorInput', () => {
  it('normalizes dollar, plain-number, and k down-payment formats', () => {
    expect(normalizeCollectorInput({ message: 'I can put 1K down' }).down_payment).toBe('1000');
    expect(normalizeCollectorInput({ message: 'down payment is $1,000' }).down_payment).toBe('1000');
    expect(normalizeCollectorInput({ message: 'I have 1000 for down' }).down_payment).toBe('1000');
  });

  it('never stores a phone-shaped value as down payment', () => {
    const result = normalizeCollectorInput({
      phone: '3019876543',
      down_payment: '3019876543',
      qualification_memory: 'down payment: 3019876543',
    });

    expect(result.down_payment).toBe('');
    expect(result.qualification_memory).not.toContain('down payment: 3019876543');
  });

  it('stores the cash portion when the lead combines it with a trade-in', () => {
    expect(normalizeCollectorInput({ message: 'Dar unos 2000 y mi carro' }).down_payment).toBe('2000 + trade-in');
    expect(normalizeCollectorInput({ message: 'I can put $2500 down and my car' }).down_payment).toBe('2500 + trade-in');
    expect(normalizeCollectorInput({ message: 'My car is the trade-in', down_payment: '2500' }).down_payment).toBe('2500 + trade-in');
  });

  it('does not invent documents from an empty or placeholder value', () => {
    const result = normalizeCollectorInput({ message: 'I want a Tacoma', documents: '--' });
    expect(result.documents).toBe('');
    expect(result.next_question).toBe('Do you have a valid ID or driver license?');
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

  it('captures affirmative document answers before the document name', () => {
    const result = normalizeCollectorInput({
      message: "Yes, I have my driver's license and proof of income",
      down_payment: ',',
    });
    expect(result.documents).toContain('identification: yes');
    expect(result.documents).toContain('proof of income: yes');
    expect(result.down_payment).toBe('');
    expect(result.next_question).toBe('');
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

  it('uses a standalone numeric reply as the pending down payment and normalizes urgent Spanish timing', () => {
    const result = normalizeCollectorInput({
      message: '2,000',
      vehicle_type: '',
      qualification_memory: 'vehicle: Suv',
    });
    expect(result.down_payment).toBe('2000');
    expect(result.vehicle_type).toBe('Suv');

    expect(normalizeCollectorInput({ message: 'Para ya' }).purchase_timeline).toBe('today');
  });

  it('removes campaign-button suffix contamination and captures a numeric reply followed by tengo', () => {
    expect(normalizeCollectorInput({ message: 'Quiero mi Auto con Eastern!10', down_payment: '10' })).toMatchObject({
      vehicle_type: '',
      down_payment: '',
    });
    expect(normalizeCollectorInput({ message: '900 tengo10' }).down_payment).toBe('900');
    expect(normalizeCollectorInput({ message: '900 tengo' }).down_payment).toBe('900');
  });

  it('reads keyed facts from contaminated workflow memory without preserving the boundary digits', () => {
    const result = normalizeCollectorInput({
      message: '900 tengo10',
      qualification_memory: '2down payment: 10 + trade-in0; vehicle: SUV',
    });
    expect(result.down_payment).toBe('900');
    expect(result.vehicle_type).toBe('SUV');
    expect(result.qualification_memory).not.toContain('trade-in0');
  });

  it('merges conversation history and replaces stale keyed facts without duplicating them', () => {
    const result = normalizeCollectorInput({
      message: 'I have proof of income',
      chat_history_log: 'I want a Toyota RAV4 SUV this week; down payment is 1K',
      qualification_memory: 'vehicle: Suv; down payment: 500',
    });
    expect(result.vehicle_type).toContain('Toyota RAV4 SUV');
    expect(result.down_payment).toBe('1000');
    expect(result.qualification_memory.match(/down payment:/g)).toHaveLength(1);
  });
});
