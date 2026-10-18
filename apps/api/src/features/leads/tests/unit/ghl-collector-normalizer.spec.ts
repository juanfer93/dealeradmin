import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const body = readFileSync(resolve(__dirname, '../../domain/ghl-collector-normalizer.js'), 'utf8');
const sourceModules = [
  '01-runtime-text.js',
  '02-contact-memory.js',
  '03-vehicle.js',
  '04-contact-flow.js',
  '05-qualification-pipeline.js',
].map((fileName) => readFileSync(resolve(__dirname, '../../domain/ghl-collector-normalizer/source/modules', fileName), 'utf8').trim());
const execute = (inputData: Record<string, unknown>) => new Function('inputData', body)(inputData) as Record<string, any>;

describe('HighLevel collector custom-code normalizer', () => {
  it('keeps the standalone entrypoint generated from the maintainable source', () => {
    expect(body).toContain('Generated GHL Custom Code entrypoint.');
    for (const sourceModule of sourceModules) expect(body).toContain(sourceModule);
    expect(body).not.toMatch(/(^|\n)\s*import\s|\brequire\s*\(/);
  });

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

  it('normalizes the Action Messenger midsize answer from Marcus Snell', () => {
    const result = execute({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Marcus Snell',
      phone: '(240) 266-6377',
      message: '240-266-6377',
      chat_history_log: 'Do you guys work with all credit or programs?\nDo you offer financing options?\nMidsize\n240-266-6377',
    });

    expect(result).toMatchObject({
      vehicle_type: 'midsize',
      vehicle_category: 'sedan',
      qualification_complete: true,
      dealeradmin_send_now: true,
      missing_qualification: [],
    });
  });

  it('preserves Toi/Moisés Stafford WhatsApp qualification memory', () => {
    const result = execute({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: 'Toi',
      phone: '+15715550123',
      message: 'Esta semana',
      chat_history_log: 'Quiero financiar un auto!\nMoisés\nBuenos días. Quería ver los modelos que tiene Andas Yvis SI, si me puedo montar por favor, algunas fotos para lograr verlos.\n1500\nEsta semana',
      qualification_memory: 'real_name: Moisés; vehicle: Quiere hablar con un asesor; down payment: 1500',
    });

    expect(result).toMatchObject({
      vehicle_type: 'Honda Civic',
      vehicle_category: 'sedan',
      qualification_complete: true,
      dealeradmin_send_now: true,
      missing_qualification: [],
    });
  });

  it('repairs a preserved advisor vehicle when GHL later contains a preference such as "I love sedans"', () => {
    const result = execute({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Katelyn Borley',
      phone: '+16147830827',
      vehicle_type: 'Quiere hablar con un asesor',
      down_payment: '1000',
      purchase_timeline: 'this week',
      chat_history_log: 'What vehicles are eligible?\nI love sedans\nI am located in Ohio\n6147830827\nI can put 1000 down.\nThis week\nYes',
    });

    expect(result).toMatchObject({
      vehicle_type: 'Sedan',
      vehicle_category: 'sedan',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('classifies Robert Schmidt\'s four-door sports-car answer as a sedan', () => {
    const transcript = [
      'You have any used vehicle',
      'Four-door sports car',
      '7174193529',
      'looking for something in 16 and under',
      '2016',
      'Yes 1000',
      'browsing for right now, but very soon',
      'Maybe',
      'I like to see some pictures of cars',
      'Yes I do i’m 61',
    ].join('\n');
    const result = execute({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Robert Schmidt',
      phone: '+17174193529',
      vehicle_type: 'Quiere hablar con un asesor',
      down_payment: '1000',
      qualification_memory: 'real_name: Robert Schmidt; vehicle: Quiere hablar con un asesor; down payment: 1000',
      message: 'Yes I do i’m 61',
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({ vehicle_type: 'Sedan', vehicle_category: 'sedan', vehicle_year: 2016 });
    expect(result.missing_qualification).not.toContain('vehicle_type');
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
    'Quiero mi Auto con Eastern STERLING!',
    'Quiero mi Auto con Eastern BALTIMORE!',
    'Quiero mi Auto con Eastern LAUREL!',
  ])('does not infer trade-in from an Easterns advertising CTA in history: %s', (buttonReply) => {
    const transcript = [buttonReply, 'Tienes un 2014 Toyota Tacoma 4x4?', '3016460540'].join('\n');
    const result = execute({
      source: 'easterns',
      channel: 'messenger',
      real_name: 'Jose Cabrera',
      message: '3016460540',
      chat_history_log: transcript,
    });

    expect(result.phone).toBe('+13016460540');
    expect(result.vehicle_type).toContain('Tacoma');
    expect(result.down_payment).toBe('');
    expect(result.qualification_memory).not.toMatch(/trade[- ]?in/i);
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

  it('replays Carlitos with the Easterns location from transcript history in Custom Code', () => {
    const result = execute({
      source: 'easterns',
      channel: 'messenger',
      real_name: 'Carlitos Caguana',
      message: '4438392149',
      chat_history_log: 'Quiero mi Auto con Eastern!\nUn auto\nPequeño\nMe puede mandar fotos para chequiar\nBaltimore\n4438392149',
    });

    expect(result).toMatchObject({
      phone: '+14438392149',
      vehicle_type: 'Sedan',
      customer_location: 'Baltimore',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('normalizes comma-separated grouped phone evidence from Ruben in Custom Code', () => {
    const result = execute({
      source: 'koons-culpeper',
      channel: 'messenger',
      real_name: 'Ruben Albarenga',
      message: '301,659,90 59',
      chat_history_log: '¿Dónde están ubicados?\nCamioneta 150\nTiene algunas fotos\n301,659,90 59',
    });

    expect(result).toMatchObject({
      phone: '+13016599059',
      vehicle_type: 'truck',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('keeps a Stafford lead with an emoji or missing GHL name', () => {
    const result = execute({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: '🤷🏻‍♂️',
      phone: '(703) 229-7352',
      message: 'Ahorasi',
      chat_history_log: 'Quiero financiar un auto\n🤷🏻‍♂️\nAhorasi',
    });

    expect(result).toMatchObject({
      phone: '+17032297352',
      vehicle_type: 'Quiere hablar con un asesor',
      qualification_complete: false,
    });
    // The collector may use the only inbound text as a temporary identity;
    // the service still persists the lead with its neutral fallback when GHL
    // supplies only an emoji/blank contact name.
    expect(result.real_name).toBe('Ahorasi');
  });

  it('does not discard an Easterns lead when GHL marks it stop bot', () => {
    const result = execute({
      source: 'easterns',
      channel: 'messenger',
      real_name: 'Jose Barahona',
      phone: '(571) 421-4544',
      tags: 'stop bot',
      message: 'no gracias',
      chat_history_log: 'Jose Barahona\nsedan\nno gracias\n5714214544',
    });

    expect(result).toMatchObject({
      real_name: 'Jose Barahona',
      phone: '+15714214544',
      qualification_complete: false,
    });
  });

  it('normalizes Kathy Warren from Easterns Frederick when the vehicle is in narrative text', () => {
    const result = execute({
      source: 'easterns-frederick',
      channel: 'messenger',
      real_name: 'Kathy Warren',
      phone: '(717) 404-1201',
      message: 'Dobyou have any locations in W Va??',
      chat_history_log: [
        'Can someone with a repo on their credit report get a vehicle??',
        'It’s my daughter who’s vehicle may not last much longer, it has over 250,000 miles on it & costs alot to repair right now. She’s the 1 with a repo from about 3 1/2 - 4 yrs ago.',
        'She has 3 kids, so she needs an SUV',
        'Do you have your job is your credit They both work full time',
        'They also have NO down payment available',
        'I guess just send it to me, & I’ll inform her',
        'Please, no phone calls, I work f/t with Uber Eats.',
        'Dobyou have any locations in W Va??',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      real_name: 'Kathy Warren',
      phone: '+17174041201',
      vehicle_type: 'SUV',
      down_payment: 'No down payment',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('normalizes Sharon Yates from Easterns Frederick without filtering the stop bot tag', () => {
    const result = execute({
      source: 'easterns-frederick',
      channel: 'messenger',
      real_name: 'Sharon Yates',
      phone: '(240) 458-8934',
      tags: 'stop bot',
      message: 'Thanks',
      chat_history_log: [
        "Hello. I'm sorry. I don't understand spanish.",
        'An suv',
        'Preferably an Armada or infinity qx55',
        '$3000',
        'My credit falls into the bad category. I am looking to buy in a month once I have some pay stubs.',
        'I have an id but not proof of income. Thats the only reason I want to wait a month. I get my 1st check from my new job on the 23rd.',
        'Thanks',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      real_name: 'Sharon Yates',
      phone: '+12404588934',
      vehicle_type: 'Armada',
      down_payment: '3000',
      identification: 'yes',
      has_income_proof: 'no',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('repairs the Culpeper Toyota Tundra transcription before advisor fallback', () => {
    const result = execute({
      source: 'koons-culpeper',
      channel: 'messenger',
      real_name: 'Lucas Benavides',
      phone: '(703) 434-2184',
      message: 'esta semana',
      chat_history_log: [
        'hola busco una toyata tandra',
        '703 434 2184',
        'yo ya ando el cheke de banco del neyvi',
        'de 30mil',
        'esta semana',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      real_name: 'Lucas Benavides',
      phone: '+17034342184',
      vehicle_type: 'Toyota Tundra',
    });
    expect(result.vehicle_type).not.toBe('Quiere hablar con un asesor');
  });

  it('replays Jose Luis Salcedo Toyota Runner wording as a 4Runner in Custom Code', () => {
    const transcript = [
      'Buenos días, bueno quería que me diera una información para ver si tenían Toyota Runner del 2016 o 217-1819 20 alguno de esos modelos',
      '8435311632',
    ].join('\n');

    expect(execute({
      source: 'easterns-frederick',
      channel: 'messenger',
      real_name: 'Jose Luis Salcedo',
      phone: '+18435311632',
      chat_history_log: transcript,
      message: '8435311632',
    })).toMatchObject({
      real_name: 'Jose Luis Salcedo',
      phone: '+18435311632',
      vehicle_type: 'Toyota 4Runner',
      vehicle_year: 2016,
    });
  });

  it('replays Rosali Saravia raw4 wording as RAV4 in Custom Code', () => {
    const transcript = [
      'Estoy buscando un raw4',
      '202 5092809',
      'Es mi número de cell',
      'Hablo español',
      'En laurel, Maryland',
    ].join('\n');

    expect(execute({
      source: 'easterns-millersville',
      channel: 'messenger',
      real_name: 'Rosalí D Saravia',
      phone: '+12025092809',
      chat_history_log: transcript,
      message: '1,500',
    })).toMatchObject({
      real_name: 'Rosalí D Saravia',
      phone: '+12025092809',
      vehicle_type: 'RAV4',
      customer_location: 'laurel',
    });
  });

  it.each([
    '4Runner',
    '4runner',
    '4 Runner',
    '4-runner',
    '4-Runner',
    '4runer',
    '4 runer',
    '4-runer',
    '4Runners',
    '4 runners',
    'four runner',
    'four-runner',
    'for runner',
    'for-runner',
    'for runer',
    'for-runer',
  ])('repairs the Culpeper 4Runner transcription variant "%s" before advisor fallback', (vehicleReply) => {
    const result = execute({
      source: 'koons-culpeper',
      channel: 'messenger',
      real_name: 'Roberto Huertas',
      phone: '7577357377',
      message: '7577357377',
      chat_history_log: `¿Qué documentos necesito?\n${vehicleReply}\n7577357377`,
    });

    expect(result).toMatchObject({
      real_name: 'Roberto Huertas',
      phone: '+17577357377',
      vehicle_type: '4Runner',
    });
    expect(result.vehicle_type).not.toBe('Quiere hablar con un asesor');
    expect(result.missing_qualification).not.toContain('vehicle_type');
  });

  it.each([
    ['Alicia Torres', '4runer', '7577357001'],
    ['Brandon Reed', '4 Runner', '7577357002'],
    ['Carla Nguyen', '4-runner', '7577357003'],
    ['Diego Morales', 'four runner', '7577357004'],
    ['Fatima Khan', 'for runer', '7577357005'],
    ['Jorge Miller', '4Runners', '7577357006'],
  ])('normalizes 4Runner variants for independent contact %s', (name, vehicleReply, phone) => {
    const result = execute({
      source: 'koons-culpeper',
      channel: 'messenger',
      real_name: name,
      phone,
      message: phone,
      chat_history_log: `I need vehicle information\n${vehicleReply}\n${phone}`,
    });

    expect(result).toMatchObject({
      real_name: name,
      phone: `+1${phone}`,
      vehicle_type: '4Runner',
    });
    expect(result.vehicle_type).not.toBe('Quiere hablar con un asesor');
  });

  it('normalizes the Culpeper colloquial truck answer Troka', () => {
    const result = execute({
      source: 'koons-culpeper',
      channel: 'messenger',
      contact_name: 'Osman Ali P Guillén',
      phone: '8049250909',
      message: '8049250909',
      chat_history_log: 'Puedo ver el inventario\nTroka\n8049250909',
    });

    expect(result).toMatchObject({
      real_name: 'Osman Ali P Guillén',
      phone: '+18049250909',
      vehicle_type: 'truck',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('normalizes Stafford "For 250" as a Ford F-250 instead of a down payment', () => {
    const result = execute({
      source: 'stafford',
      channel: 'whatsapp',
      phone: '(703) 229-7352',
      message: 'For 250',
      chat_history_log: 'For 250',
    });

    expect(result).toMatchObject({ vehicle_type: 'F-250', phone: '+17032297352', down_payment: '' });
    expect(result.vehicle_type).not.toBe('Quiere hablar con un asesor');
  });

  it.each([
    ['U coche 🚗 pequeño', 'Sedan'],
    ['un coche pekeno', 'Sedan'],
    ['auto chico', 'Sedan'],
  ])('normalizes compact-car wording %s to %s in Custom Code', (message, expected) => {
    const result = execute({
      channel: 'messenger',
      message,
      vehicle_type: 'Quiere hablar con un asesor',
    });

    expect(result.vehicle_type).toBe(expected);
    expect(result.qualification_memory).toContain(`vehicle: ${expected}`);
    expect(result.missing_qualification).not.toContain('vehicle_type');
  });

  it('replays Orlando Jones Jr. without losing the suffix, small-car category, or down payment in Custom Code', () => {
    expect(execute({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Orlando Jones Jr.',
      phone: '+14102270075',
      message: "I’m looking for a small car that I can use to run back-and-forth to DC on a daily basis from Maryland\nI’m looking for a car $10,000 or less I’ll put down at least 2000 if not pay for the whole thing upfront",
    })).toMatchObject({
      real_name: 'Orlando Jones Jr',
      phone: '+14102270075',
      vehicle_type: 'Sedan',
      vehicle_year: null,
      down_payment: '2000',
    });
    expect(execute({ source: 'action-cars', channel: 'messenger', message: 'Busco un carro pequeño' }).vehicle_type).toBe('Sedan');
  });

  it('normalizes Stafford WhatsApp "Algo económico" to Sedan during reconciliation', () => {
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      phone: '+19392249226',
      vehicle_type: 'Quiere hablar con un asesor',
      message: 'Gabriel Centeno\nAlgo económico\nNormal\n1,000 máximo\nPuerto Rico\nSi\nEsta semana semana me encuentro en Fayetteville NC',
      chat_history_log: 'Gabriel Centeno\nAlgo económico\nNormal\n1,000 máximo\nPuerto Rico\nSi\nEsta semana semana me encuentro en Fayetteville NC',
    })).toMatchObject({ vehicle_type: 'Sedan', previous_financing: 'yes', down_payment_sufficient: false });
  });

  it('normalizes Stafford WhatsApp "Camionetq" as a truck in Custom Code', () => {
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      phone: '+12406882096',
      real_name: 'Manuel',
      message: 'Manuel\nCamionetq\nE financiado en otro lugar\n2000\nEste mes',
      chat_history_log: 'Manuel\nCamionetq\nE financiado en otro lugar\n2000\nEste mes',
    })).toMatchObject({
      real_name: 'Manuel',
      vehicle_type: 'truck',
      required_down_payment: 3000,
      down_payment: '2000',
      down_payment_sufficient: false,
    });
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
      qualification_step: 'complete',
    });
  });

  it('separates a vehicle year from down payment when GHL repeats the year in custom fields', () => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      vehicle_type: '2018 Honda Accord',
      down_payment: '2018',
      message: 'I can put 1000 down',
      chat_history_log: 'I can put 1000 down',
    })).toMatchObject({
      vehicle_year: 2018,
      down_payment: '1000',
      down_payment_amount: 1000,
    });
  });

  it('keeps the minimum as additive evidence without blocking the common flow', () => {
    const result = execute({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Customer',
      phone: '+15405550123',
      message: 'Toyota Corolla, tengo 1K',
    });
    expect(result).toMatchObject({
      vehicle_type: 'Toyota Corolla',
      vehicle_category: 'sedan',
      required_down_payment: 1500,
      down_payment: '1000',
      down_payment_sufficient: false,
      qualification_step: 'complete',
      qualification_complete: true,
    });
    expect(result.next_question).toBe('');
  });

  it.each([
    ['stafford', 'whatsapp', 'SUV', 'Sí'],
    ['fredericksburg', 'messenger', 'Toyota Tacoma', 'Yes, I financed a vehicle before'],
  ])('keeps the common qualification complete after financing-history wording: %s', (source, channel, vehicle, answer) => {
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
      qualification_step: 'complete',
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
      qualification_step: 'complete',
    });
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'QA Buyer',
      phone: '+15405550123',
      message: 'No',
      chat_history_log: 'QA Buyer\nToyota Tacoma\n1000',
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    }).next_question).toBe('');
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
    })).toMatchObject({ previous_financing: 'yes', down_payment: '1000', down_payment_sufficient: false });
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
    })).toMatchObject({ previous_financing: '', down_payment: '1000', down_payment_sufficient: false });
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
    })).toMatchObject({ previous_financing: '', down_payment: '1000', down_payment_sufficient: false, next_question: '' });
  });

  it.each([
    ['Sedan', 'Tengo 1000\nSí', '1500'],
    ['SUV', 'Tengo 1500\nSí sí podría', '2000'],
    ['minivan', 'Tengo 1500\nSi', '2000'],
    ['Tacoma', 'Tengo 2500\nSi puedo conseguir solo que me den tiempo', '3000'],
  ])('preserves an inbound amount without applying a minimum gate in Custom Code: %s', (vehicle, transcript, minimum) => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: vehicle,
      message: transcript,
      chat_history_log: transcript,
      previous_predicted_bot_question: `Te comento que el mínimo para este vehículo es de $${minimum}. ¿Crees que podrías conseguir un poco más?`,
    })).toMatchObject({
      down_payment: transcript.match(/Tengo (\d+)/)?.[1],
      down_payment_amount: Number(transcript.match(/Tengo (\d+)/)?.[1]),
      required_down_payment: Number(minimum),
      down_payment_sufficient: false,
    });
  });

  it.each(['Con ese monto', 'Con este monto', 'Sí, con ese monto', 'Ese monto sí lo tengo', 'Con esa cantidad está bien'])('uses the predicted minimum for a contextual amount confirmation in Custom Code: %s', (reply) => {
    expect(execute({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'QA Customer',
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
      qualification_step: 'complete',
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
  ])('does not apply a minimum gate to varied replies in Custom Code: %s / %s / %s', (vehicle, amount, reply, minimum) => {
    const transcript = `${vehicle}\nTengo ${amount}\n${reply}`;
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: vehicle,
      message: transcript,
      chat_history_log: transcript,
      previous_predicted_bot_question: `Te comento que el mínimo para este vehículo es de $${minimum}. ¿Crees que podrías conseguir un poco más?`,
    })).toMatchObject({ down_payment: amount, down_payment_sufficient: false });
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
      qualification_step: 'complete',
    });
  });

  it.each(['Tacoma con trade in', 'Busco una Tacoma y tengo mi carro para entregar', 'Quiero una Tacoma, cambio mi vehículo'])('accepts flexible trade-in wording for Offlease: %s', (message) => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Customer',
      phone: '+15405550123',
      message,
    })).toMatchObject({
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment: 'trade-in',
      down_payment_sufficient: true,
      qualification_step: 'complete',
    });
  });

  it('recognizes no tengo pago inicial as a flexible-dealer down answer', () => {
    expect(execute({ source: 'easterns', real_name: 'QA Customer', message: 'No tengo pago inicial' })).toMatchObject({
      down_payment: 'No down payment',
      qualification_step: 'vehicle_type',
    });
  });

  it('lets Offlease cash payment continue past the down-payment step', () => {
    expect(execute({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Customer',
      phone: '+15405550123',
      message: 'Busco una Tacoma y voy a pagar de contado',
    })).toMatchObject({
      down_payment: 'Pagara en cash / de contado',
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment_sufficient: true,
      qualification_step: 'complete',
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
    expect(result.qualification_step).toBe('complete');
    expect(result.qualification_progress.predicted_bot_question).toBe('');
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
    ['Tecoma', 'Tacoma'],
    ['Rav 4', 'RAV4'],
    ['4 runner', '4Runner'],
    ['for runner', '4Runner'],
    ['for runer', '4Runner'],
  ])('canonicalizes a controlled model spelling variant in Custom Code: %s', (message, expected) => {
    expect(execute({ message }).vehicle_type).toBe(expected);
  });

  it('replays the exact Jaimen Cruz GHL inbound transcript in Custom Code', () => {
    const transcript = [
      'Holaa ando buscando una for runer 4x4 2010 ho 2015',
      '8046532943',
      'No se como trabajan ustedes',
    ].join('\n');

    expect(execute({
      source: 'koons-culpeper',
      channel: 'messenger',
      contact_name: 'Jaimen Cruz',
      chat_history_log: transcript,
      message: 'No se como trabajan ustedes',
    })).toMatchObject({
      phone: '+18046532943',
      vehicle_type: '4Runner',
    });
  });

  it('replays the exact Luis A Sandoval GHL inbound transcript in Custom Code', () => {
    const transcript = [
      'Dónde queda moon?',
      'Dónde queda koon',
      'Fluke',
      'Truk',
      'Tecoma',
      'Economico',
      'No entra la llamada',
      'Llamarme por Messenger',
      'Este es mi numero 919 8797239',
      'Mil',
      'Puedes enseñarlos',
      'Vivo en carolina',
      'Estoy buscando pociones',
      'Si',
      'Tengo todos mis papeles?',
      'Ya le llamé y no entra la llamada',
    ].join('\n');

    expect(execute({
      source: 'koons-fred',
      channel: 'messenger',
      contact_name: 'Dónde Queda Moon',
      chat_history_log: transcript,
      message: 'Ya le llamé y no entra la llamada',
    })).toMatchObject({
      phone: '+19198797239',
      vehicle_type: 'Tacoma',
      down_payment: '1000',
    });
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

  it('does not use WhatsApp ad metadata as a name and maps a family passenger request to a van in Custom Code', () => {
    const transcript = [
      '*Headline:* Financiamiento interno! *Source URL:* https://fb.me/cUWAq5MPm Me interrwa lo del.post',
      'Ando buscando algo familiar para 7 pasajeros',
      'Francisco medina',
      'Puedo conseguir 2000',
      'Tengo 2000',
      'Cuando se pueda.',
      'Esta semana si es posible',
      'Estoy en baltimore',
      'Si',
      'Mañana',
      'A las 1130',
      'Tienes algunos modelos para ver',
    ].join('\n');

    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Me Interrwa Lo del',
      phone: '+14434202361',
      vehicle_type: 'Quiere hablar con un asesor',
      qualification_memory: 'real_name: Me Interrwa Lo del; vehicle: Quiere hablar con un asesor; down payment: 2000; timeline: esta semana',
      message: 'Tienes algunos modelos para ver',
      chat_history_log: transcript,
    })).toMatchObject({
      real_name: 'Francisco Medina',
      phone: '+14434202361',
      vehicle_type: 'van',
      down_payment: '2000',
      purchase_timeline: 'esta semana',
    });
  });

  it('does not use a vehicle statement as an Arlington buyer name in Custom Code', () => {
    expect(execute({
      source: 'arlington',
      channel: 'messenger',
      real_name: 'Tienen Ford King Ranch',
      phone: '+14348062679',
      vehicle_type: 'Ford King ranch',
      message: 'Tienen Ford King ranch, +14348062679 Ford King ranch, comprobante de ingresos, quiere comprar este mes.',
    })).toMatchObject({
      real_name: '',
      vehicle_type: 'Ford King ranch',
    });
  });

  it('replays Alonzo Gerber’s Arlington Messenger vehicle answer as a routable Tacoma in Custom Code', () => {
    const transcript = [
      'Hola',
      'Una tacomo manual de 4 puerta',
      '2402740544',
      'Con 5000',
      'Mandame la direccion para yegar ber los beiculos',
    ].join('\n');

    expect(execute({
      source: 'arlington',
      channel: 'messenger',
      real_name: 'Alonzo Gerber',
      contact_name: 'Alonzo Gerber',
      phone: '+12402740544',
      chat_history_log: transcript,
      message: 'Mandame la direccion para yegar ber los beiculos',
      vehicle_type: 'Quiere hablar con un asesor',
    })).toMatchObject({
      real_name: 'Alonzo Gerber',
      phone: '+12402740544',
      vehicle_type: 'Tacoma',
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment: '5000',
      qualification_complete: true,
    });
  });

  it('uses the Messenger contact name as real_name in Custom Code', () => {
    expect(execute({
      channel: 'messenger',
      contact_name: 'Hay Les Aviso',
      message: 'Que requisitos necesito',
    }).real_name).toBe('Hay Les Aviso');
  });

  it('keeps the decorated Messenger profile name ahead of a contaminated payment answer in Custom Code', () => {
    const transcript = [
      'Quiero financiar un auto',
      'Ando en busca de honda oh un Toyota',
      'Un Sedan 🚘',
      '5715162438',
      '$2000',
      'Lo necesito lo más pronto Sería esta semana',
      'Me pagan cheque',
      'Licencia y pasaporte',
    ].join('\n');

    expect(execute({
      source: 'arlington',
      channel: 'messenger',
      real_name: 'Me Pagan Cheque',
      contact_name: 'Andrea⚘️',
      message: 'Licencia y pasaporte',
      chat_history_log: transcript,
    }).real_name).toBe('Andrea');
  });

  it('does not promote the Easterns vehicle-intent reply to real_name in Custom Code', () => {
    expect(execute({
      channel: 'messenger',
      contact_name: 'Juiccy Zayy',
      message: 'Need a vehicle fast',
      chat_history_log: 'Need a vehicle fast\nSUV\nBaltimore',
    }).real_name).toBe('Juiccy Zayy');
    expect(execute({ message: 'Need a vehicle fast' }).real_name).toBe('');
  });

  it.each(['Más Información', 'Mas informacion', 'More information', 'Más info', 'Details'])
    ('rejects a campaign information label as a buyer name in Custom Code: %s', (label) => {
      expect(execute({ channel: 'messenger', contact_name: label, message: 'SUV' }).real_name).toBe('');
    });

  it.each([
    ['I am Ana Torres', 'Ana Torres'],
    ["I'm Juan Pérez", 'Juan Pérez'],
    ['My name\'s María López', 'María López'],
    ['Llámame Carlos', 'Carlos'],
  ])('recognizes declared names in Spanish and English in Custom Code: %s', (message, expected) => {
    expect(execute({ channel: 'whatsapp', message }).real_name).toBe(expected);
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

  it('uses the latest vehicle for Stafford WhatsApp and Fredericksburg Messenger', () => {
    const stafford = execute({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: 'Juan Jose Castillo',
      contact_phone: '+19107093650',
      chat_history_log: [
        'Juan Jose Castillo',
        'Estoy interesado en una Honda CRV 2014',
        'O un Honda Civic 2012',
        'Un sedan',
        '1500',
      ].join('\n'),
      message: '1500',
    });
    const fredericksburg = execute({
      source: 'fredericksburg',
      channel: 'messenger',
      contact_name: 'Juan Jose Castillo',
      message: 'Tengo 1500 para el down',
      chat_history_log: [
        'Estoy interesado en una Honda CRV 2014',
        'O un Honda Civic 2012',
        'Un sedan',
        '804-970-1204',
        'Tengo 1500 para el down',
      ].join('\n'),
    });

    expect(stafford).toMatchObject({ vehicle_type: 'sedan', down_payment: '1500', required_down_payment: 1500, down_payment_sufficient: true });
    expect(fredericksburg).toMatchObject({ phone: '+18049701204', vehicle_type: 'sedan', down_payment: '1500', required_down_payment: 1500, down_payment_sufficient: true });
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
    ['I am looking for a Mustang', 'en', 'phone', "What's the best phone number to reach you?"],
    ['Estoy buscando un Mustang', 'es', 'phone', '¿Cuál es el mejor número para contactarte?'],
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

  it('replays the noisy Subaru STI answer with the common speech-to-text alias', () => {
    const result = execute({
      channel: 'messenger',
      real_name: 'Roger Romero',
      message: 'Si ando en busca de un suvaru sti 2017',
      vehicle_type: 'Quiere hablar con un asesor',
    });

    expect(result).toMatchObject({
      vehicle_type: 'Subaru STI',
      vehicle_year: 2017,
    });
    expect(result.missing_qualification).not.toContain('vehicle_type');
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
    expect(result.missing_qualification).toEqual(['phone']);
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

  it('keeps the Custom Code vehicle year separate from an explicit down payment', () => {
    expect(execute({ message: 'Quiero el Honda Civic 2020 y tengo 2500 de down' })).toMatchObject({
      vehicle_year: 2020,
      down_payment: '2500',
    });
  });

  it('accepts Spanish down-payment intent for an intermediate amount in Custom Code', () => {
    expect(execute({ message: 'Doy 1800' })).toMatchObject({
      vehicle_year: null,
      down_payment: '1800',
    });
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
    expect(result.dealeradmin_send_now).toBe(true);
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

  it.each([
    ['7046990761', '+17046990761'],
    ['704-699-0761', '+17046990761'],
    ['(704) 699-0761', '+17046990761'],
    ['704 699 07 61', '+17046990761'],
    ['704.699.07.61', '+17046990761'],
    ['+1 704 699 07 61', '+17046990761'],
    ['1 (704) 699-0761', '+17046990761'],
  ])('normalizes phone formatting %s from the conversation', (phone, expected) => {
    expect(execute({ message: `Es ${phone}` }).phone).toBe(expected);
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
    expect(result.missing_qualification).toContain('phone');
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

  it('keeps Messenger identity in profile metadata instead of the intent message', () => {
    const result = execute({
      channel: 'messenger',
      contact_name: 'Juan Perez',
      message: 'Can I See Inventory',
      chat_history_log: 'Can I See Inventory',
    });

    expect(result.real_name).toBe('Juan Perez');
    expect(result.real_name).not.toContain('Inventory');
  });

  it('uses the WhatsApp profile name when the inbound body is only a greeting', () => {
    expect(execute({
      channel: 'whatsapp',
      profile: { name: 'Juan Perez' },
      message: 'Buenos Días Bendiciones',
    }).real_name).toBe('Juan Perez');
  });

  it('maps the Stafford shorthand year pair to 2015 and does not extract $15', () => {
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: 'Me Puede Mandar Fotos',
      phone: '+15713169760',
      message: 'Soy Jaime !',
      chat_history_log: 'Tienes hondas civic 2014/15\nSoy Jaime !',
    })).toMatchObject({
      real_name: 'Jaime',
      vehicle_type: 'Civic',
      vehicle_year: 2015,
      down_payment: '',
    });
  });

  it('prefers the explicitly declared Stafford name over a photo-request profile label', () => {
    expect(execute({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Me Puede Mandar Fotos',
      contact_name: 'Me Puede Mandar Fotos',
      phone: '+14103016969',
      message: 'Ando buscando un Honda civic',
      chat_history_log: 'Hola cómo está mi nombre es Manuel\nAndo buscando un Honda civic',
      qualification_memory: 'real_name: Me Puede Mandar Fotos; vehicle: Honda Civic',
    }).real_name).toBe('Manuel');
  });

  it.each([
    'Can I See Inventory',
    'Buenos Días Bendiciones',
    'Ana María López García Hernández Rivera',
  ])('rejects non-name text from becoming real_name: %s', (message) => {
    expect(execute({ channel: 'whatsapp', message }).real_name).toBe('');
  });
});
