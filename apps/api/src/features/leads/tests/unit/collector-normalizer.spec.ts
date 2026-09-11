import { describe, expect, it } from 'vitest';
import { detectLeadLanguage, hasMinimumRoutingQualification, isQualificationComplete, normalizeCollectorInput } from '../../domain/collector-normalizer';

describe('normalizeCollectorInput', () => {
  it.each([
    ['I am looking for a sedan this month.', 'en'],
    ['Quiero un sedán este mes.', 'es'],
    ['SUV', 'es'],
  ])('detects the conversation language without using a vehicle label alone: %s', (message, expected) => {
    expect(detectLeadLanguage(message)).toBe(expected);
  });

  it('recognizes a clearly English qualification conversation instead of defaulting to Spanish', () => {
    expect(detectLeadLanguage('I need more information. What documents do you need? I have proof of income.')).toBe('en');
  });

  it('preserves a valid native GHL contact phone when the latest message is separate', () => {
    expect(normalizeCollectorInput({ phone: '(240) 681-5028', message: 'Ok' }).phone).toBe('+12406815028');
  });

  it.each([
    ['(240) 681-5028', '+12406815028'],
    ['240.681.5028', '+12406815028'],
    ['240 681 5028', '+12406815028'],
    ['+12406815028', '+12406815028'],
    ['12406815028', '+12406815028'],
    ['2406815028', '+12406815028'],
  ])('normalizes native GHL phone format %s', (phone, expected) => {
    expect(normalizeCollectorInput({ message: 'Ok', phone }).phone).toBe(expected);
  });

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

  it('does not interpret a trade-in vehicle year as the down payment and recognizes bank statements as income proof', () => {
    const transcript = [
      'pudo ver su inventario',
      'Sedan',
      'Por laurel',
      'En realidad quería ver si puedo hacer un trade in. Tengo un subaru wrx 2021 que aun lo sigo pagando.',
      '1000',
      'Quisiera cambiarlo este mes',
      'Tengo ITIN. Y comprobante solo mis estados de cuenta ya que trabajo de manera independiente',
    ].join('\n');
    const result = normalizeCollectorInput({ message: transcript, chat_history_log: transcript, phone: '+12272599238' });

    expect(result.vehicle_type).toBe('Sedan');
    expect(result.down_payment).toBe('1000 + trade-in');
    expect(result.identification).toBe('yes');
    expect(result.has_income_proof).toBe('yes');
    expect(result.documents).toContain('proof of income: yes');
    expect(result.missing_qualification).toEqual(['bank_account']);
  });

  it.each([
    ['I have bank statements', 'yes'],
    ['I have account statements', 'yes'],
    ['Tengo colillas de cheques', 'yes'],
    ['I have check stubs', 'yes'],
    ['I have proof of income', 'yes'],
    ['I have a bank account', 'yes'],
    ['Tengo cuenta bancaria', 'yes'],
  ])('treats income evidence as proof of income: %s', (message, expected) => {
    expect(normalizeCollectorInput({ message }).has_income_proof).toBe(expected);
  });

  it.each(['I have my passport', 'Tengo mi pasaporte'])('treats passport as valid identification: %s', (message) => {
    expect(normalizeCollectorInput({ message }).identification).toBe('yes');
  });

  it('accepts a trade-in as the down payment even without a cash amount', () => {
    expect(normalizeCollectorInput({ qualification_memory: 'make: Toyota; model: RAV4; down payment: trade-in; timeline: today; documents: driver license and proof of income; bank account: yes' })).toMatchObject({
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
    expect(normalizeCollectorInput({ qualification_memory: 'make: Honda; model: Civic; down payment: trade-in + 2K; timeline: today; documents: ID and proof of income; bank account: yes' })).toMatchObject({
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

  it('removes the known GHL custom-code plus AI concatenation from vehicle values', () => {
    expect(normalizeCollectorInput({ vehicle_type: 'Toyota hilanderVehicle: Toyota hilanderToyota hilander' }).vehicle_type)
      .toBe('Toyota hilander');
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
    expect(result.next_question).toBe('Do you have a bank account?');
  });

  it('deduplicates repeated document facts before persistence', () => {
    const result = normalizeCollectorInput({
      documents: 'identification: yes; identification: yes; proof of income: yes; identification: yes',
      qualification_memory: 'vehicle: Ford; down payment: 2000; timeline: today; bank account: yes',
    });

    expect(result.documents.match(/identification: yes/g)).toHaveLength(1);
    expect(result.documents.match(/proof of income: yes/g)).toHaveLength(1);
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

  it.each([
    ['1000', '1000'],
    ['2000', '2000'],
    ['3000', '3000'],
  ])('keeps standalone cash amount %s as down payment', (message, expected) => {
    expect(normalizeCollectorInput({ message }).down_payment).toBe(expected);
  });

  it.each(['2018', '2019', '2025'])('does not classify a standalone vehicle year as down payment: %s', (message) => {
    expect(normalizeCollectorInput({ message }).down_payment).toBe('');
  });

  it('extracts a declared personal name from a Stafford conversation', () => {
    expect(normalizeCollectorInput({ message: 'Elias alvarado' }).real_name).toBe('Elias Alvarado');
  });

  it('extracts a declared personal name from the complete inbound transcript', () => {
    const result = normalizeCollectorInput({
      real_name: 'EliasJosue 🕊Mnegra',
      message: '*Headline:* Financiamiento interno! Quiero financiar un auto!\nElias alvarado\nAun auto económico para el trabajo',
      chat_history_log: '*Headline:* Financiamiento interno! Quiero financiar un auto!\nElias alvarado\nAun auto económico para el trabajo',
    });
    expect(result.real_name).toBe('Elias Alvarado');
    expect(result.vehicle_type).toBe('');
  });

  it.each(['Que requisitos necesito', 'What requirements do I need'])('does not classify a requirements question as a real name: %s', (message) => {
    expect(normalizeCollectorInput({ message, real_name: message }).real_name).toBe('');
  });

  it.each([
    'Quiero financiar un auto',
    'Me gustaría financiar un auto con ustedes',
  ])('does not classify an advertising financing button as a vehicle: %s', (message) => {
    expect(normalizeCollectorInput({ message, vehicle_type: 'financiar un auto' }).vehicle_type).toBe('');
  });

  it.each(['Más información', 'Más info', 'Quiero más información', 'More details', 'Learn more'])('does not classify an information intent as a vehicle: %s', (message) => {
    expect(normalizeCollectorInput({ message, vehicle_type: message }).vehicle_type).toBe('');
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
    'vehicle_type = SUV\ndown_payment: $2,000\ndocuments: driver license, proof of income\npurchase_timeline: this week\nbank account: yes',
    '{"vehicle_type":"SUV","down_payment":"2K","documents":"ID and proof of income","purchase_timeline":"this week","bank_account":"yes"}',
    '• vehicle: SUV | • down payment: 2000 | • identification: yes | • proof of income: yes | • timeline: this week | • bank account: yes',
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
    expect(result.missing_qualification).toEqual(['purchase_timeline', 'proof_of_income', 'bank_account']);
    expect(result.next_question).toBe('Do you have proof of income?');
  });

  it('uses qualification memory as the canonical document value when a custom field is stale', () => {
    const result = normalizeCollectorInput({
      documents: 'not specified',
      qualification_memory: 'vehicle: SUV; down payment: 2K; documents: driver license and proof of income; timeline: today; bank account: yes',
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
      bank_account: 'yes',
    })).toBe(true);
    expect(isQualificationComplete({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'today',
      has_identification: 'yes',
      has_income_proof: '',
    })).toBe(false);
  });

  it('requires only a phone before a lead enters dealerADMIN', () => {
    expect(hasMinimumRoutingQualification({ phone: '+15551234567' })).toBe(true);
    expect(hasMinimumRoutingQualification({ phone: '' })).toBe(false);
  });

  it('does not treat campaign or intent text as a purchase timeline', () => {
    expect(normalizeCollectorInput({ purchase_timeline: 'Quiero Financiar!' }).purchase_timeline).toBe('');
    expect(normalizeCollectorInput({ qualification_memory: 'timeline: Dónde están ubicados102020' }).purchase_timeline).toBe('');
    expect(normalizeCollectorInput({ message: 'Hoy mismo' }).purchase_timeline).toBe('today');
  });

  it('normalizes free-form Spanish memory without requiring keyed fields', () => {
    const result = normalizeCollectorInput({
      qualification_memory: 'El lead tiene una troca para trade-in y quiere el vehículo hoy mismo.',
    });
    expect(result.down_payment).toBe('trade-in');
    expect(result.purchase_timeline).toBe('today');
  });

  it.each([
    ['real_name: Maria Lopez; vehicle: SUV', '.', 'Maria Lopez'],
    ['nombre completo: Juan Pérez; vehículo: Sedan', 'Thu Chikitha Linda', 'Juan Pérez'],
  ])('uses the real name from memory when the contact name is invalid: %s', (memory, field, expected) => {
    expect(normalizeCollectorInput({ real_name: field, qualification_memory: memory }).real_name).toBe(expected);
  });

  it('captures a standalone full-name answer without confusing vehicle intent for a name', () => {
    expect(normalizeCollectorInput({ message: 'María José López' }).real_name).toBe('María José López');
    expect(normalizeCollectorInput({ message: 'Quiero una camioneta' }).real_name).toBe('');
  });

  it.each([
    ['elias alvarado', 'Elias Alvarado'],
    ['JUAN de la cruz', 'Juan de la Cruz'],
    ["maria-jose o'neal", "Maria-Jose O'Neal"],
  ])('formats personal names consistently: %s', (message, expected) => {
    expect(normalizeCollectorInput({ message }).real_name).toBe(expected);
  });

  it('prefers a declared personal name over a commercial Messenger profile, while retaining it as fallback', () => {
    expect(normalizeCollectorInput({ real_name: 'Tatuajes y operaciones', message: 'Juan Andino' }).real_name).toBe('Juan Andino');
    expect(normalizeCollectorInput({ real_name: 'Tatuajes y operaciones', message: 'Quiero una camioneta' }).real_name).toBe('Tatuajes y operaciones');
  });

  it('rejects qualification answers as names and removes contaminated name memory', () => {
    const result = normalizeCollectorInput({
      real_name: 'En este mes',
      qualification_memory: '20; real_name: En este mes; vehicle: sedan; timeline: este mes',
      message: 'Giovanni Amador',
    });

    expect(result.real_name).toBe('Giovanni Amador');
    expect(result.qualification_memory).not.toContain('real_name: En este mes');
    expect(result.qualification_memory).not.toMatch(/(?:^|;)\s*20(?:;|$)/);
  });

  it('rejects a phone phrase as a name and removes it from memory', () => {
    const result = normalizeCollectorInput({
      message: 'Mí número es 5714223667',
      qualification_memory: '0',
      phone: '+15714223667',
    });

    expect(result.real_name).toBe('');
    expect(result.qualification_memory).toBe('');
  });

  it('does not treat a document confirmation as bank-account confirmation', () => {
    const result = normalizeCollectorInput({
      message: 'Sí, sí tengo',
      documents: 'identification: yes, proof of income: yes',
    });

    expect(result.identification).toBe('yes');
    expect(result.has_income_proof).toBe('yes');
    expect(result.bank_account).toBe('');
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
