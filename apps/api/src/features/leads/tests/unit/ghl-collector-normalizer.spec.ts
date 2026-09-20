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

  it('normalizes carro económico to Sedan for WhatsApp and Messenger contacts in Custom Code', () => {
    expect(execute({
      channel: 'whatsapp',
      message: 'Busco un carro economico para esta semana',
    }).vehicle_type).toBe('Sedan');

    expect(execute({
      channel: 'messenger',
      message: 'Busco un carro economico para esta semana',
    }).vehicle_type).toBe('Sedan');
  });

  it('normalizes Stafford WhatsApp "Algo económico" to Sedan during reconciliation', () => {
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      phone: '+19392249226',
      vehicle_type: 'Quiere hablar con un asesor',
      message: 'Gabriel Centeno\nAlgo económico\nNormal\n1,000 máximo\nPuerto Rico\nSi\nEsta semana semana me encuentro en Fayetteville NC',
      chat_history_log: 'Gabriel Centeno\nAlgo económico\nNormal\n1,000 máximo\nPuerto Rico\nSi\nEsta semana semana me encuentro en Fayetteville NC',
    })).toMatchObject({ vehicle_type: 'Sedan', previous_financing: 'yes', down_payment_sufficient: true });
  });

  it.each([
    ['1000', '1000'],
    ['2000', '2000'],
    ['3000', '3000'],
    ['3 mil', '3000'],
    ['Tengo 2 mil', '2000'],
    ['dos mil', '2000'],
    ['tres mil', '3000'],
    ['4 mil', '4000'],
    ['5 mil', '5000'],
    ['10 mil', '10000'],
    ['1K', '1000'],
    ['2K', '2000'],
    ['3K', '3000'],
    ['4K', '4000'],
    ['five thousand', '5000'],
    ['siete mil', '7000'],
    ['six thousand', '6000'],
  ])('normalizes down-payment spelling %s in Custom Code', (message, expected) => {
    expect(execute({ message }).down_payment).toBe(expected);
  });

  it('keeps the full "Tengo 2 mil" amount when the transcript also contains a phone', () => {
    const result = execute({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'Rafael Araque',
      phone: '+18644842725',
      message: 'Yes sir.',
      chat_history_log: [
        'Quiero Financiar!',
        'Suv',
        '8644842725 tex',
        'Tengo 2 mil',
        'Westa semana',
        'Yes sir.',
      ].join('\n'),
    });
    expect(result).toMatchObject({
      vehicle_type: 'Suv',
      down_payment: '2000',
      down_payment_amount: 2000,
      required_down_payment: 2000,
      down_payment_sufficient: true,
      qualification_step: 'purchase_timeline',
    });
  });

  it('keeps Offlease strict and predicts the minimum after an insufficient down payment', () => {
    const result = execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      message: 'Toyota Corolla, tengo 1K',
    });
    expect(result).toMatchObject({
      vehicle_type: 'Toyota Corolla',
      vehicle_category: 'sedan',
      required_down_payment: 1500,
      down_payment: '1000',
      down_payment_sufficient: false,
      qualification_step: 'down_payment',
      qualification_complete: false,
    });
    expect(result.next_question).toContain('financiado');
  });

  it.each([
    ['stafford', 'whatsapp', 'SUV', 'Sí'],
    ['fredericksburg', 'messenger', 'Toyota Tacoma', 'Yes, I financed a vehicle before'],
  ])('accepts the $1000 Offlease promotion only after the financing-history question: %s', (source, channel, vehicle, answer) => {
    expect(execute({
      source,
      channel,
      phone: '+15405550123',
      real_name: 'QA Buyer',
      message: answer,
      chat_history_log: `QA Buyer\n${vehicle}\n1000`,
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    })).toMatchObject({
      previous_financing: 'yes',
      down_payment: '1000',
      down_payment_amount: 1000,
      down_payment_sufficient: true,
      qualification_step: 'purchase_timeline',
    });
  });

  it('keeps the regular minimum when the financing-history answer is negative in Custom Code', () => {
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      phone: '+15405550123',
      message: 'No',
      chat_history_log: 'Carlos\nTroca\n1000',
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    })).toMatchObject({
      previous_financing: 'no',
      down_payment: '1000',
      down_payment_sufficient: false,
      qualification_step: 'down_payment',
    });
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'QA Buyer',
      phone: '+15405550123',
      message: 'No',
      chat_history_log: 'QA Buyer\nToyota Tacoma\n1000',
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    }).next_question).toContain('$3000');
  });

  it.each(['Sí', 'si podria', 'Sí, podría', 'si puedo', 'con este monto', 'Con este monto y no lo identifico', 'ese monto sí lo tengo', 'Claro', 'Yes, I could', 'I can finance 1000', 'Anteriormente financié un vehículo'])('accepts varied affirmative financing-history wording in Custom Code: %s', (answer) => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Buyer',
      phone: '+15405550123',
      message: answer,
      chat_history_log: 'Toyota Tacoma\n1000',
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    })).toMatchObject({ previous_financing: 'yes', down_payment: '1000', down_payment_sufficient: true });
  });

  it('does not reuse an old financing question when the current predictor question is about the regular minimum in Custom Code', () => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Buyer',
      phone: '+15405550123',
      message: 'Sí',
      chat_history_log: 'Toyota Tacoma\n1000\nPara aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?\nSí',
      previous_predicted_bot_question: 'Te comento que el mínimo para este vehículo es de $3000. ¿Crees que podrías conseguir más?',
    })).toMatchObject({ previous_financing: '', down_payment: '3000', down_payment_sufficient: true });
  });

  it('repeats the financing-history question when Custom Code receives an unrelated answer', () => {
    const question = 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?';
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Buyer',
      phone: '+15405550123',
      message: 'Estoy en Baltimore',
      chat_history_log: 'Toyota Tacoma\n1000',
      previous_predicted_bot_question: question,
    })).toMatchObject({ previous_financing: '', down_payment: '1000', down_payment_sufficient: false, next_question: question });
  });

  it.each([
    ['Sedan', 'Tengo 1000\nSí', '1500'],
    ['SUV', 'Tengo 1500\nSí sí podría', '2000'],
    ['minivan', 'Tengo 1500\nSi', '2000'],
    ['Tacoma', 'Tengo 2500\nSi puedo conseguir solo que me den tiempo', '3000'],
  ])('promotes an inbound shortfall confirmation in Custom Code: %s', (vehicle, transcript, minimum) => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: vehicle,
      message: transcript,
      chat_history_log: transcript,
      previous_predicted_bot_question: `Te comento que el mínimo para este vehículo es de $${minimum}. ¿Crees que podrías conseguir un poco más?`,
    })).toMatchObject({
      down_payment: minimum,
      down_payment_amount: Number(minimum),
      required_down_payment: Number(minimum),
      down_payment_sufficient: true,
    });
  });

  it.each(['Con ese monto', 'Con este monto', 'Sí, con ese monto', 'Ese monto sí lo tengo', 'Con esa cantidad está bien'])('uses the predicted minimum for a contextual amount confirmation in Custom Code: %s', (reply) => {
    expect(execute({
      source: 'fredericksburg-2',
      channel: 'messenger',
      phone: '+15718351684',
      vehicle_type: 'Toyota Tacoma',
      message: reply,
      chat_history_log: reply,
      previous_predicted_bot_question: 'Perfecto. Para las trocas requerimos un enganche mínimo de $3000 (o pago de contado). ¿Con cuánto contarías tú para el enganche o cómo planeas tu pago?',
    })).toMatchObject({
      down_payment: '3000',
      down_payment_amount: 3000,
      required_down_payment: 3000,
      down_payment_sufficient: true,
      qualification_step: 'purchase_timeline',
    });
  });

  it('does not treat an amount reference as a down confirmation without a predictor question in Custom Code', () => {
    expect(execute({
      source: 'fredericksburg-2',
      channel: 'messenger',
      vehicle_type: 'Toyota Tacoma',
      message: 'Con ese monto',
      chat_history_log: 'Con ese monto',
    })).toMatchObject({ down_payment: '' });
  });

  it('does not promote an affirmative turn without the predictor shortfall question in Custom Code', () => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: 'Sedan',
      message: 'Tengo 1000\nSí',
      chat_history_log: 'Tengo 1000\nSí',
    })).toMatchObject({ down_payment: '1000', down_payment_sufficient: false });
  });

  it.each([
    ['Sedan', '1000', 'Sí', 1500],
    ['Sedan', '1000', 'Si si podria', 1500],
    ['SUV', '1500', 'Sí, podría', 2000],
    ['SUV', '1500', 'Sí puedo', 2000],
    ['minivan', '1000', 'Claro, puedo conseguir más', 2000],
    ['van', '1200', 'Ok, puedo subirle', 2000],
    ['Tacoma', '2500', 'Yes, I could bring more', 3000],
    ['truck', '2000', 'Yeah, I can get more', 3000],
    ['pickup', '2500', 'Bien, podría conseguir más', 3000],
    ['SUV', '1500', 'Correcto, puedo subir más', 2000],
  ])('passes ten varied affirmative shortfall replies in Custom Code: %s / %s / %s', (vehicle, amount, reply, minimum) => {
    const transcript = `${vehicle}\nTengo ${amount}\n${reply}`;
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: vehicle,
      message: transcript,
      chat_history_log: transcript,
      previous_predicted_bot_question: `Te comento que el mínimo para este vehículo es de $${minimum}. ¿Crees que podrías conseguir un poco más?`,
    })).toMatchObject({ down_payment: String(minimum), down_payment_sufficient: true });
  });

  it('allows Offlease trade-in to satisfy the down-payment requirement', () => {
    const result = execute({
      source: 'stafford',
      channel: 'messenger',
      real_name: 'Carlos',
      phone: '+15405550123',
      message: 'Toyota Tacoma, 2K y trade-in',
      purchase_timeline: 'this week',
    });
    expect(result).toMatchObject({
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment: '2000 + trade-in',
      down_payment_sufficient: true,
      qualification_complete: true,
      qualification_step: 'documents',
    });
  });

  it.each(['Tacoma con trade in', 'Busco una Tacoma y tengo mi carro para entregar', 'Quiero una Tacoma, cambio mi vehículo'])('accepts flexible trade-in wording for Offlease: %s', (message) => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      message,
    })).toMatchObject({
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment: 'trade-in',
      down_payment_sufficient: true,
      qualification_step: 'purchase_timeline',
    });
  });

  it('recognizes no tengo pago inicial as a flexible-dealer down answer', () => {
    expect(execute({ source: 'easterns', message: 'No tengo pago inicial' })).toMatchObject({
      down_payment: 'No down payment',
      qualification_step: 'vehicle_type',
    });
  });

  it('lets Offlease cash payment continue past the down-payment step', () => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      message: 'Busco una Tacoma y voy a pagar de contado',
    })).toMatchObject({
      down_payment: 'Pagara en cash / de contado',
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment_sufficient: true,
      qualification_step: 'purchase_timeline',
    });
  });

  it('skips a greeting and extracts the following simple name from the Stafford WhatsApp transcript in Custom Code', () => {
    const result = execute({
      channel: 'whatsapp',
      contact_name: '~',
      phone: '+19297563553',
      message: 'Saludos\nAmin\nBusco carro del 2019 en adelante\nSedan\n500$',
      chat_history_log: 'Saludos\nAmin\nBusco carro del 2019 en adelante\nSedan\n500$',
    });

    expect(result.real_name).toBe('Amin');
    expect(result.vehicle_type).toBe('Sedan');
    expect(result.down_payment).toBe('500');
    expect(result.qualification_step).toBe('purchase_timeline');
    expect(result.qualification_progress.predicted_bot_question).toBe('¿Cuándo planeas comprar?');
  });

  it('does not cross transcript lines and read a phone area code as down payment in Custom Code', () => {
    const result = execute({
      phone: '+14438626592',
      vehicle_type: 'SUV',
      chat_history_log: 'But I have down payment\n443 862-6592\nCould you do 700?',
      message: 'No I need a car like yesterday!!',
    });

    expect(result.phone).toBe('+14438626592');
    expect(result.down_payment).toBe('');
  });

  it('ignores a stale area-code-only down field but keeps an explicit down amount in Custom Code', () => {
    expect(execute({ phone: '+14438626592', vehicle_type: 'SUV', message: 'A small SUV', down_payment: '443' }).down_payment).toBe('');
    expect(execute({ phone: '+14438626592', message: 'I have 443 down' }).down_payment).toBe('443');
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

  it('keeps the make/model from the Sarah Saints Messenger transcript in Custom Code', () => {
    const transcript = [
      'Quiero financiar un auto',
      'Este carro menos de 8K',
      '2014 Honda Civic EX',
      '5716946924',
    ].join('\n');

    expect(execute({ channel: 'messenger', contact_name: 'Sarah Saints', chat_history_log: transcript, message: '5716946924' })).toMatchObject({
      vehicle_type: 'Honda Civic EX',
      phone: '+15716946924',
    });
  });

  it('normalizes the misspelled Corolla from the Milciades Hernandez Messenger transcript in Custom Code', () => {
    const transcript = [
      'Me gustaria financiar un auto',
      'Corola',
      '571.513.29.79',
    ].join('\n');

    expect(execute({ channel: 'messenger', contact_name: 'Milciades Hernandez', message: '571.513.29.79', chat_history_log: transcript })).toMatchObject({
      vehicle_type: 'Corolla',
      phone: '+15715132979',
    });
  });

  it.each([
    ['Corola', 'Corolla'],
    ['civc', 'Civic'],
    ['Tacma', 'Tacoma'],
    ['Rav 4', 'RAV4'],
    ['4 runner', '4Runner'],
  ])('canonicalizes a controlled model spelling variant in Custom Code: %s', (message, expected) => {
    expect(execute({ message }).vehicle_type).toBe(expected);
  });

  it.each(['Este carro menos de 8K', 'Más información', '2014'])('does not promote arbitrary Custom Code text to vehicle_type: %s', (value) => {
    expect(execute({ message: value, vehicle_type: value }).vehicle_type).toBe('');
  });

  it('extracts a declared personal name from the complete inbound transcript in Custom Code', () => {
    const transcript = '*Headline:* Financiamiento interno! Quiero financiar un auto!\nElias alvarado\nAun auto económico para el trabajo';
    expect(execute({ real_name: 'EliasJosue 🕊Mnegra', message: transcript, chat_history_log: transcript })).toMatchObject({
      real_name: 'Elias Alvarado',
      vehicle_type: 'Sedan',
    });
  });

  it('uses the Messenger contact name as real_name in Custom Code', () => {
    expect(execute({
      channel: 'messenger',
      contact_name: 'Hay Les Aviso',
      message: 'Que requisitos necesito',
    }).real_name).toBe('Hay Les Aviso');
  });

  it('keeps the requested vehicle after a name intro separated by a comma', () => {
    expect(execute({
      channel: 'messenger',
      contact_name: 'QA Igual',
      message: 'Soy QA Igual, busco un Honda Civic y tengo 1500 de down; compro esta semana.',
    })).toMatchObject({
      vehicle_type: 'Honda Civic',
      down_payment: '1500',
      vehicle_category: 'sedan',
      required_down_payment: 1500,
      down_payment_sufficient: true,
    });
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

  it('scores the complete Custom Code transcript and localizes a Spanish timeline', () => {
    const transcript = [
      'Hola, variedad en chevrolet maneja, busco uno en 4 o 6 cilindros con modelo 2lt',
      'Oh un chevrolet según su anuncio manejan con estética deportiva',
      'Un suv',
      '8642651776',
      'Es mi numero',
      'Si me interesa un camaro con paquete 2lt del año',
      'me gustaria hacer la compra en efectivo esta semana',
    ].join('\n');
    expect(execute({ channel: 'messenger', real_name: 'Gabriel Gonzalez', message: 'Con gusto!', chat_history_log: transcript })).toMatchObject({
      vehicle_type: 'Chevrolet Camaro 2LT',
      purchase_timeline: 'esta semana',
    });
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

  it('marks a phone-only inbound handoff as advisor contact without qualifying it as a vehicle', () => {
    const result = execute({
      real_name: 'Oscar Hernández',
      message: '804 546 1032',
    });

    expect(result).toMatchObject({
      phone: '+18045461032',
      vehicle_type: 'Quiere hablar con un asesor',
      qualification_step: 'vehicle_type',
      qualification_complete: false,
    });
    expect(result.missing_qualification).toContain('vehicle_type');
  });

  it.each(['Quiero cambiar mi vehículo', 'Cambio de auto', 'I want to change my vehicle'])('maps vehicle-change language to trade-in: %s', (message) => {
    const result = execute({ message });
    expect(result.down_payment).toBe('trade-in');
  });

  it('recognizes explicit vehicle handoff and Hummer text in Custom Code', () => {
    const result = execute({ message: 'Hummer sut\nQuisiera ver si puedo entregar mi vehículo\nAhora si se puede' });
    expect(result.vehicle_type).toBe('Hummer sut');
    expect(result.down_payment).toBe('trade-in');
    expect(result.purchase_timeline).toBe('hoy');
  });

  it.each([
    ['camión', 'truck'],
    ['camioneta', 'truck'],
  ])('normalizes Spanish vehicle categories in Custom Code: %s', (message, expected) => {
    expect(execute({ message }).vehicle_type).toBe(expected);
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

  it('does not normalize prices and mileage as a Messenger phone', () => {
    const result = execute({
      channel: 'messenger',
      contact_name: 'Negussie Gebremariam',
      message: 'Nissan Altima, Honda, Hyundai with price maximum $15,000\nMileage not more than 70,000',
    });

    expect(result.phone).toBe('');
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
    ['3 mil', '3000'],
    ['Tengo 2 mil', '2000'],
    ['dos mil', '2000'],
    ['tres mil', '3000'],
    ['4 mil', '4000'],
    ['5 mil', '5000'],
    ['10 mil', '10000'],
    ['1K', '1000'],
    ['2K', '2000'],
    ['3K', '3000'],
    ['4K', '4000'],
    ['siete mil', '7000'],
    ['six thousand', '6000'],
    ['five thousand', '5000'],
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

  it('captures one-word Yahir from the reproduced WhatsApp transcript only', () => {
    const result = execute({
      channel: 'whatsapp',
      message: 'A las 5 si se puede por favor',
      chat_history_log: '*Headline:* Financiamiento inmediato\nYahir\nQuiero ver si puedo con 1000\nLo más pronto posible\nQue y qué papeles ocupo para aplicar\nSedan\nSi sin problema\nSi está bien no hay problema\nHoy si gusta\nA las 5 si se puede por favor',
    });
    expect(result.real_name).toBe('Yahir');
    expect(execute({ channel: 'whatsapp', message: 'Sedan' }).real_name).toBe('');
    expect(execute({ channel: 'whatsapp', message: 'Lo más pronto posible' }).real_name).toBe('');
    expect(execute({ channel: 'whatsapp', message: 'Mi nombre es Yahir Pérez' }).real_name).toBe('Yahir Pérez');
    expect(execute({ channel: 'whatsapp', message: 'Quiero ver si puedo con 1000' }).down_payment).toBe('1000');
  });

  it('does not promote a location question and combines a colloquial truck with its Ford make in Custom Code', () => {
    const transcript = [
      'Donde estan hubicados',
      'Javier ayala',
      'Tendras una tropical ford',
      'Trokita',
      '4 puertas',
      '1000',
      'Down',
      'X el momento solo cuento con 1000..',
      'Me esperaria a junta esa cantidad gracias..si se puede con 1000 esta semana',
      'Si',
      'Despues de las7',
    ].join('\n');
    expect(execute({
      channel: 'whatsapp',
      phone: '+19842986568',
      message: transcript,
      chat_history_log: transcript,
      documents: 'identification: yes; proof of income: yes',
    })).toMatchObject({
      real_name: 'Javier Ayala',
      vehicle_type: 'Ford Truck',
      down_payment: '1000',
      purchase_timeline: 'esta semana',
      identification: 'yes',
      has_income_proof: 'yes',
    });
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

  it('keeps mixed document statuses attached to their own document', () => {
    const result = execute({
      documents: 'identification: yes, proof of income: no',
    });

    expect(result.identification).toBe('yes');
    expect(result.has_income_proof).toBe('no');
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
    expect(result.qualification_memory).toBe('vehicle: Quiere hablar con un asesor');
    expect(result.phone).toBe('+15714223667');
  });
});
