import { describe, expect, it } from 'vitest';
import { isQualificationComplete, normalizeCollectorInput } from '../../domain/collector-normalizer';

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

  it('accepts a trade-in as the down payment even without a cash amount', () => {
    expect(normalizeCollectorInput({ qualification_memory: 'make: Toyota; model: RAV4; down payment: trade-in; timeline: today; documents: driver license and proof of income' })).toMatchObject({
      vehicle_type: 'Toyota RAV4',
      down_payment: 'trade-in',
      qualification_complete: true,
    });
  });

  it.each([
    'Quiero cambiar mi vehículo',
    'Cambio de auto',
    'I want to change my vehicle',
  ])('normalizes vehicle-change language as trade-in: %s', (message) => {
    expect(normalizeCollectorInput({ message }).down_payment).toBe('trade-in');
  });

  it('keeps the cash portion when vehicle-change language is combined with a payment', () => {
    expect(normalizeCollectorInput({ message: 'Quiero cambiar mi vehículo y poner $2,000' }).down_payment).toBe('2000 + trade-in');
    expect(normalizeCollectorInput({ down_payment: 'cambio mi auto + 2K' }).down_payment).toBe('2000 + trade-in');
  });

  it('combines a trade-in and cash amount when both are stored in memory', () => {
    expect(normalizeCollectorInput({ qualification_memory: 'make: Honda; model: Civic; down payment: trade-in + 2K; timeline: today; documents: ID and proof of income' })).toMatchObject({
      vehicle_type: 'Honda Civic',
      down_payment: '2000 + trade-in',
      qualification_complete: true,
    });
  });

  it.each([
    ['today', 'today'],
    ['this week', 'this week'],
    ['this month', 'this month'],
    ['in 2 weeks', 'in 2 weeks'],
    ['en dos semanas', 'en dos semanas'],
    ['in a month', 'in a month'],
    ['next month', 'next month'],
  ])('preserves purchase timeline variant %s', (answer, expected) => {
    expect(normalizeCollectorInput({ message: answer }).purchase_timeline).toBe(expected);
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

  it.each([
    'vehicle_type = SUV\ndown_payment: $2,000\ndocuments: driver license, proof of income\npurchase_timeline: this week',
    '{"vehicle_type":"SUV","down_payment":"2K","documents":"ID and proof of income","purchase_timeline":"this week"}',
    '• vehicle: SUV | • down payment: 2000 | • identification: yes | • proof of income: yes | • timeline: this week',
  ])('promotes complete qualification memory into normalized fields: %s', (qualification_memory) => {
    const result = normalizeCollectorInput({ qualification_memory });
    expect(result).toMatchObject({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'this week',
      qualification_complete: true,
      missing_qualification: [],
    });
    expect(result.documents).toMatch(/(?:driver license|ID)/i);
    expect(result.documents).toMatch(/proof of income/i);
  });

  it('keeps a partial memory on the collector branch and reports exactly what is missing', () => {
    const result = normalizeCollectorInput({
      qualification_memory: 'vehicle: SUV; down payment: 2K; documents: identification: yes',
    });
    expect(result.qualification_complete).toBe(false);
    expect(result.missing_qualification).toEqual(['purchase_timeline', 'proof_of_income']);
    expect(result.next_question).toBe('Do you have proof of income?');
  });

  it('uses qualification memory as the canonical document value when a custom field is stale', () => {
    const result = normalizeCollectorInput({
      documents: 'not specified',
      qualification_memory: 'vehicle: SUV; down payment: 2K; documents: driver license and proof of income; timeline: today',
    });
    expect(result.documents).toContain('driver license and proof of income');
    expect(result.qualification_complete).toBe(true);
    expect(result.qualification_source).toBe('qualification_memory');
  });

  it('requires every qualification fact before the downstream trigger can treat a lead as ready', () => {
    expect(isQualificationComplete({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'today',
      has_identification: 'yes',
      has_income_proof: 'yes',
    })).toBe(true);
    expect(isQualificationComplete({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'today',
      has_identification: 'yes',
      has_income_proof: '',
    })).toBe(false);
  });

  it.each([
    [{ vehicle_type: 'SUV' }, 'custom_fields'],
    [{ qualification_memory: 'vehicle: SUV' }, 'qualification_memory'],
    [{ vehicle_type: 'SUV', qualification_memory: 'vehicle: SUV' }, 'both'],
    [{}, 'none'],
  ] as const)('identifies whether qualification came from %s', (input, expected) => {
    expect(normalizeCollectorInput(input).qualification_source).toBe(expected);
  });
});
