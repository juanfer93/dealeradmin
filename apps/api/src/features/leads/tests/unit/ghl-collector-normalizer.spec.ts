import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const body = readFileSync(resolve(__dirname, '../../domain/ghl-collector-normalizer.js'), 'utf8');
const execute = (inputData: Record<string, unknown>) => new Function('inputData', body)(inputData) as Record<string, any>;

describe('HighLevel collector custom-code normalizer', () => {
  it('promotes a complete qualification memory without custom fields', () => {
    const result = execute({
      real_name: 'QA Customer',
      phone: '+13015550123',
      qualification_memory: 'vehicle_type = SUV\ndown_payment: 2000\ndocuments: driver license, proof of income\npurchase_timeline: this week\nbank_account: yes',
    });
    expect(result).toMatchObject({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'this week',
      identification: 'yes',
      has_income_proof: 'yes',
      qualification_complete: true,
      qualification_source: 'qualification_memory',
      missing_qualification: [],
    });
  });

  it('uses memory to repair stale custom fields and reports both sources', () => {
    const result = execute({
      real_name: 'QA Customer',
      phone: '+13015550123',
      vehicle_type: 'Truck',
      down_payment: '10',
      documents: 'not specified',
      qualification_memory: 'vehicle: SUV; down payment: 2K; documents: ID and proof of income; timeline: today; bank account: yes',
    });
    expect(result).toMatchObject({
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'today',
      identification: 'yes',
      has_income_proof: 'yes',
      qualification_complete: true,
      qualification_source: 'both',
    });
  });

  it('does not promote a campaign-button suffix into a down payment', () => {
    const result = execute({ message: 'Quiero mi Auto con Eastern!10', down_payment: '10' });
    expect(result.down_payment).toBe('');
    expect(result.qualification_complete).toBe(false);
  });

  it.each([
    'Quiero financiar un auto',
    'Me gustaría financiar un auto con ustedes',
  ])('does not classify an advertising financing button as a vehicle in Custom Code: %s', (message) => {
    expect(execute({ message, vehicle_type: 'financiar un auto' }).vehicle_type).toBe('');
  });

  it.each(['Más información', 'Más info', 'Quiero más información', 'More details', 'Learn more'])('does not classify an information intent as a vehicle in Custom Code: %s', (message) => {
    expect(execute({ message, vehicle_type: message }).vehicle_type).toBe('');
  });

  it('extracts a declared personal name from the complete inbound transcript in Custom Code', () => {
    const transcript = '*Headline:* Financiamiento interno! Quiero financiar un auto!\nElias alvarado\nAun auto económico para el trabajo';
    expect(execute({ real_name: 'EliasJosue 🕊Mnegra', message: transcript, chat_history_log: transcript })).toMatchObject({
      real_name: 'Elias Alvarado',
      vehicle_type: '',
    });
  });

  it('uses the Messenger contact name as real_name in Custom Code', () => {
    expect(execute({
      channel: 'messenger',
      contact_name: 'Hay Les Aviso',
      message: 'Que requisitos necesito',
    }).real_name).toBe('Hay Les Aviso');
  });

  it('uses only a declared chat name for WhatsApp in Custom Code', () => {
    expect(execute({
      channel: 'whatsapp',
      contact_name: 'EliasJosue 🕊Mnegra',
      message: 'Me llamo Elias Alvarado',
    }).real_name).toBe('Elias Alvarado');
    expect(execute({
      channel: 'whatsapp',
      contact_name: 'EliasJosue 🕊Mnegra',
      message: 'Estoy buscando un Mustang',
    }).real_name).toBe('');
  });

  it.each([
    ['I am looking for a Mustang', 'en', 'real_name', 'What is your full name?'],
    ['Estoy buscando un Mustang', 'es', 'real_name', '¿Cuál es tu nombre completo?'],
  ])('predicts step and next question for %s in Custom Code', (message, language, step, question) => {
    const result = execute({ channel: 'whatsapp', message });
    expect(result.qualification_progress).toMatchObject({
      step,
      language,
      predicted_bot_question: question,
    });
    expect(result.next_question).toBe(question);
  });

  it('maps answers after questions without using the questions as evidence', () => {
    const transcript = [
      'What vehicle are you looking for?',
      'Honda Civic',
      'What is your phone number?',
      '804-970-1204',
      'How much can you put down?',
      '2000',
      'When are you planning to buy?',
      'This month',
      'Do you have ID and a bank account?',
      'Yes, I have my passport and bank statements.',
      'What is your name?',
      'Emma Oertly',
    ].join('\n');
    const result = execute({ channel: 'messenger', contact_name: 'Emma Oertly', chat_history_log: transcript });
    expect(result).toMatchObject({
      real_name: 'Emma Oertly',
      phone: '+18049701204',
      vehicle_type: 'Honda Civic',
      down_payment: '2000',
      purchase_timeline: 'this month',
      identification: 'yes',
      has_income_proof: 'yes',
      qualification_complete: true,
    });
    expect(result.bank_account).toBe('');
  });

  it.each(['Quiero cambiar mi vehículo', 'Cambio de auto', 'I want to change my vehicle'])('maps vehicle-change language to trade-in: %s', (message) => {
    const result = execute({ message });
    expect(result.down_payment).toBe('trade-in');
  });

  it('keeps an incomplete memory on the collector branch and names what is missing', () => {
    const result = execute({ qualification_memory: 'vehicle: SUV; down payment: 2K; documents: identification: yes' });
    expect(result.qualification_complete).toBe(false);
    expect(result.missing_qualification).toEqual(['real_name', 'phone', 'purchase_timeline', 'proof_of_income', 'bank_account']);
  });

  it('keeps a trade-in vehicle year out of the down payment and recognizes bank statements', () => {
    const transcript = [
      'pudo ver su inventario',
      'Sedan',
      'Por laurel',
      'En realidad quería ver si puedo hacer un trade in. Tengo un subaru wrx 2021 que aun lo sigo pagando.',
      '1000',
      'Quisiera cambiarlo este mes',
      'Tengo ITIN. Y comprobante solo mis estados de cuenta ya que trabajo de manera independiente',
    ].join('\n');
    const result = execute({ message: transcript, chat_history_log: transcript, phone: '+12272599238' });

    expect(result).toMatchObject({
      vehicle_type: 'Sedan',
      down_payment: '1000 + trade-in',
      identification: 'yes',
      has_income_proof: 'yes',
    });
    expect(result.documents).toContain('proof of income: yes');
  });

  it.each(['I have bank statements', 'I have account statements', 'Tengo colillas de cheques', 'I have check stubs', 'I have a bank account', 'Tengo cuenta bancaria'])('maps income evidence in the Custom Code: %s', (message) => {
    expect(execute({ message }).has_income_proof).toBe('yes');
  });

  it.each(['I have my passport', 'Tengo mi pasaporte'])('maps passport as identification in the Custom Code: %s', (message) => {
    expect(execute({ message }).identification).toBe('yes');
  });

  it('normalizes an explicit phone from the inbound message for the GHL contact phone output', () => {
    const result = execute({
      message: 'Sedan, mi numero de telefono es (804) 309-2531',
      qualification_memory: 'documents: identification: yes; proof of income: yes',
    });
    expect(result).toMatchObject({ vehicle_type: 'Sedan', phone: '+18043092531' });
    expect(result.qualification_memory).toContain('vehicle: Sedan');
  });

  it.each([
    ['Tiene Mustang', 'Mustang'],
    ['Estoy buscando un Mustang', 'Mustang'],
    ['I am looking for a Ford Explorer', 'Ford Explorer'],
  ])('classifies a vehicle statement as vehicle data and not a real name in Custom Code: %s', (message, expected) => {
    const result = execute({ message, real_name: message });
    expect(result.real_name).toBe('');
    expect(result.vehicle_type).toBe(expected);
  });

  it('ignores the Easterns advertising phrase when it arrives in vehicle_type in Custom Code', () => {
    expect(execute({ message: 'financiar con Easterns', vehicle_type: 'financiar con Easterns' }).vehicle_type).toBe('');
  });

  it.each([
    ['1000', '1000'],
    ['2000', '2000'],
    ['3000', '3000'],
  ])('keeps standalone cash amount %s as down payment in Custom Code', (message, expected) => {
    expect(execute({ message }).down_payment).toBe(expected);
  });

  it.each(['2018', '2019', '2025'])('does not classify a standalone vehicle year as down payment in Custom Code: %s', (message) => {
    expect(execute({ message }).down_payment).toBe('');
  });

  it('extracts Elias Alvarado from the Stafford conversation in Custom Code', () => {
    expect(execute({ message: 'Elias alvarado' }).real_name).toBe('Elias Alvarado');
  });

  it('prefers the phone written in the message and ignores a stale contact phone', () => {
    const result = execute({
      phone: '+14970120410',
      message: 'Mi número es 8049701204',
    });

    expect(result.phone).toBe('+18049701204');
  });

  it('uses a valid native contact phone when the conversation message omits it', () => {
    const result = execute({
      phone: '+14970120410',
      message: 'Estoy buscando una SUV',
    });

    expect(result.phone).toBe('+14970120410');
  });

  it('preserves Samuel Etienne phone when GHL sends it separately from the final message', () => {
    const result = execute({
      phone: '(240) 681-5028',
      message: 'Ok',
      qualification_memory: 'vehicle: SUVvehicle: SUVvehicle: SUV',
    });

    expect(result.phone).toBe('+12406815028');
    expect(result.dealeradmin_send_now).toBe(false);
  });

  it.each([
    ['(240) 681-5028', '+12406815028'],
    ['240.681.5028', '+12406815028'],
    ['240 681 5028', '+12406815028'],
    ['+12406815028', '+12406815028'],
    ['12406815028', '+12406815028'],
    ['2406815028', '+12406815028'],
  ])('normalizes phone format %s', (phone, expected) => {
    expect(execute({ message: 'Ok', phone }).phone).toBe(expected);
  });

  it('captures a standalone full-name answer without treating a vehicle request as a name', () => {
    expect(execute({ message: 'María José López' }).real_name).toBe('María José López');
    expect(execute({ message: 'Quiero una camioneta' }).real_name).toBe('');
  });

  it.each([
    ['elias alvarado', 'Elias Alvarado'],
    ['JUAN de la cruz', 'Juan de la Cruz'],
    ["maria-jose o'neal", "Maria-Jose O'Neal"],
  ])('formats personal names consistently in Custom Code: %s', (message, expected) => {
    expect(execute({ message }).real_name).toBe(expected);
  });

  it('prefers a declared personal name over a commercial profile, while retaining it as fallback', () => {
    expect(execute({ real_name: 'Tatuajes y operaciones', message: 'Juan Andino' }).real_name).toBe('Juan Andino');
    expect(execute({ real_name: 'Tatuajes y operaciones', message: 'Quiero una camioneta' }).real_name).toBe('Tatuajes y operaciones');
  });

  it('rejects a timeline as a name, cleans contaminated memory, and requires bank account confirmation', () => {
    const result = execute({
      real_name: 'En este mes',
      qualification_memory: '20; real_name: En este mes; vehicle: sedan; timeline: este mes',
      message: 'Giovanni Amador',
    });

    expect(result.real_name).toBe('Giovanni Amador');
    expect(result.qualification_memory).not.toContain('real_name: En este mes');
    expect(result.qualification_memory).not.toMatch(/(?:^|;)\s*20(?:;|$)/);
    expect(result.missing_qualification).toContain('bank_account');
    expect(result.qualification_complete).toBe(false);
  });

  it('does not treat a document confirmation as bank-account confirmation', () => {
    const result = execute({
      message: 'Sí, sí tengo',
      documents: 'identification: yes, proof of income: yes',
    });

    expect(result.identification).toBe('yes');
    expect(result.has_income_proof).toBe('yes');
    expect(result.bank_account).toBe('');
  });

  it('does not convert vehicle digits in qualification memory into a phone', () => {
    const result = execute({
      qualification_memory: 'real_name: Stefanni.veliz; vehicle: SUV20202020202020; timeline: today',
    });

    expect(result.phone).toBe('');
    expect(result.vehicle_type).toBe('SUV');
  });

  it('never treats a phone phrase as a real name or qualification memory', () => {
    const result = execute({
      message: 'Mí número es 5714223667',
      qualification_memory: '0',
      phone: '(571) 422-3667',
    });

    expect(result.real_name).toBe('');
    expect(result.qualification_memory).toBe('');
    expect(result.phone).toBe('+15714223667');
  });
});
