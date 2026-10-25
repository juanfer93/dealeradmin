import { describe, expect, it } from 'vitest';
import { ADVISOR_HANDOFF_VEHICLE, detectLeadLanguage, extractRecentMessagePhone, hasMinimumRoutingQualification, isAdvisorHandoffVehicle, isQualificationComplete, isValidRealName, normalizeCollectorInput, normalizeRealName } from '../../domain/collector-normalizer';

describe('normalizeCollectorInput', () => {
  it('normalizes accented Spanish sedan wording during reconciliation', () => {
    expect(normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      message: 'Necesito un sedán de bajo precio',
      chat_history_log: 'Necesito un sedán de bajo precio',
      phone: '+15405607865',
    }).vehicle_type).toBe('Sedan');
  });

  it.each([
    ['What vehicles are eligible?\nAnything you got\n814 603 0494', 'en'],
    ['No sé qué carro quiero\n814 603 0494', 'es'],
    ['I am not sure what vehicle I want\n814 603 0494', 'en'],
    ['No tengo preferencia de vehículo\n814 603 0494', 'es'],
  ])('defaults an indecisive %s conversation to Sedan', (transcript, language) => {
    const result = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Indecisive Buyer',
      message: transcript.split('\n').at(-1) ?? '',
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({
      phone: '+18146030494',
      vehicle_type: 'Sedan',
      vehicle_category: 'sedan',
      qualification_complete: true,
      missing_qualification: [],
      qualification_progress: { language },
    });
  });

  it('keeps an explicit vehicle ahead of a later indecision phrase', () => {
    const result = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Vehicle Buyer',
      message: 'I am not sure anymore',
      chat_history_log: 'Toyota Tacoma\nI am not sure anymore\n814 603 0494',
    });

    expect(result.vehicle_type).toBe('Toyota Tacoma');
  });

  it('normalizes Katherine Amaya\'s Spanish truck and down-payment answer', () => {
    const result = normalizeCollectorInput({
      source: 'koons-fredericksburg',
      channel: 'messenger',
      real_name: 'Katherine Amaya',
      phone: '5712417295',
      message: 'Estoy buscando una troca tengo $1500 de daw',
      chat_history_log: 'Estoy buscando una troca tengo $1500 de daw\n5712417295',
    });

    expect(result).toMatchObject({
      real_name: 'Katherine Amaya',
      phone: '+15712417295',
      vehicle_type: 'truck',
      down_payment: '1500',
    });
  });

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

  it('normalizes Marcus Snell\'s Action Messenger midsize answer as a qualified vehicle', () => {
    const transcript = [
      'Do you guys work with all credit or programs?',
      'Do you offer financing options?',
      'Midsize',
      '240-266-6377',
    ].join('\n');
    const result = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Marcus Snell',
      phone: '(240) 266-6377',
      message: '240-266-6377',
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({
      real_name: 'Marcus Snell',
      phone: '+12402666377',
      vehicle_type: 'midsize',
      vehicle_category: 'sedan',
      qualification_complete: true,
      dealeradmin_send_now: true,
      missing_qualification: [],
    });
    expect(result.qualification_memory).toContain('vehicle: midsize');
  });

  it('keeps Toi/Moisés Stafford WhatsApp qualification memory across the inbound transcript', () => {
    const transcript = [
      'Quiero financiar un auto!',
      'Moisés',
      'Buenos días. Quería ver los modelos que tiene Andas Yvis SI, si me puedo montar por favor, algunas fotos para lograr verlos.',
      '1500',
      'Esta semana',
    ].join('\n');
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: 'Toi',
      phone: '+15715550123',
      message: 'Esta semana',
      chat_history_log: transcript,
      qualification_memory: 'real_name: Moisés; vehicle: Quiere hablar con un asesor; down payment: 1500',
    });

    expect(result).toMatchObject({
      real_name: 'Moisés',
      phone: '+15715550123',
      vehicle_type: 'Honda Civic',
      vehicle_category: 'sedan',
      down_payment: '1500',
      qualification_complete: true,
      dealeradmin_send_now: true,
      missing_qualification: [],
    });
    expect(result.qualification_memory).toContain('vehicle: Honda Civic');
  });

  it('classifies a four-door sports-car answer as a sedan instead of preserving the advisor marker', () => {
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
    const result = normalizeCollectorInput({
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

    expect(result).toMatchObject({ vehicle_type: 'Sedan 2016', vehicle_category: 'sedan', vehicle_year: 2016 });
    expect(result.missing_qualification).not.toContain('vehicle_type');
    expect(result.qualification_memory).toContain('vehicle: Sedan');
  });

  it('normalizes Manuel Stafford\'s misspelled Camionetq answer as a truck', () => {
    const transcript = [
      '*Headline:* Financiamiento interno! Source URL: x Quiero financiar un auto!',
      'Si',
      'Manuel',
      'Camionetq',
      'E financiado en otro lugar',
      'Si mandame models porfavor',
      'Solo mandame models el enhance ntpes',
      '2000',
      'Este mes',
      'Solo mandame modelosnporfavor',
    ].join('\n');

    expect(normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: 'Manuel Rivera',
      phone: '+12406882096',
      message: transcript,
      chat_history_log: transcript,
    })).toMatchObject({
      real_name: 'Manuel',
      phone: '+12406882096',
      vehicle_type: 'truck',
      vehicle_category: 'truck',
      down_payment: '2000',
      required_down_payment: 3000,
      down_payment_amount: 2000,
      down_payment_sufficient: false,
      qualification_step: 'complete',
    });
  });

  it('repairs Danilo Rivera\'s stale Ford F--150 snapshot and recognizes the $3,000 truck minimum', () => {
    const transcript = [
      'informacion',
      'Ford f150 fx4',
      '571 379 6440',
      '3k',
      'Pero no kiero algo caro',
      'Estoy mirando aver si me interasa algo',
      'Si tienes algo que me interese si',
      'Si pero primero kiero ver los carros aver cual me interesa',
      'Muestrame las fotos',
      'Si porfavor',
      'Ok',
      'Manda las fotos',
    ].join('\n');
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Danilo Rivera',
      phone: '+15713796440',
      vehicle_type: 'Ford F--150',
      down_payment: '3000',
      qualification_memory: 'real_name: Danilo Rivera; vehicle: Ford F--150; down payment: 3000',
      message: transcript,
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({
      real_name: 'Danilo Rivera',
      phone: '+15713796440',
      vehicle_type: 'Ford F-150',
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment_amount: 3000,
      down_payment_sufficient: true,
      missing_qualification: [],
      qualification_complete: true,
    });
  });

  it('does not persist HighLevel\'s technical Location label as a buyer name', () => {
    const result = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Location',
      phone: '+14438593407',
      message: 'Primeor\nTahoe\n1000 down',
      chat_history_log: 'Primeor\nTahoe\n1000 down',
    });

    expect(result.real_name).toBe('Primeor');
    expect(normalizeRealName('Location')).toBe('');
  });

  it.each(['Más Información', 'Mas informacion', 'More information', 'Más info', 'Details'])
    ('rejects a campaign information label as a buyer name: %s', (label) => {
      expect(normalizeRealName(label)).toBe('');
      expect(normalizeCollectorInput({ channel: 'messenger', real_name: label, message: 'SUV' }).real_name).toBe('');
    });

  it('keeps the declared WhatsApp name and normalizes a noisy Silverado plus dollar down answer', () => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Manda',
      phone: '+12404427364',
      message: 'Mi troca. No. Bale. Nada',
      chat_history_log: '¡Hola! Quiero más información\nManda. Una. Ubicasion\nBenigno\nNo Agara. Ban. Por. Una. Silverado q. Qro. 2020\nMándame. Foto. De. Las. Troca. Y. En. Cuánto. Sale. Afinaciada\nY. No. Me. Agara. Mi. Ban\nYo. Cuento. Con. Mi. Ban. Y. 2000dolare\nMi troca. No. Bale. Nada',
    });

    expect(result).toMatchObject({
      real_name: 'Benigno',
      vehicle_type: 'Silverado 2020',
      down_payment: '2000 + trade-in',
      qualification_step: 'complete',
    });
  });

  it('accepts a van trade-in with a cash down amount even when the buyer writes it conversationally', () => {
    expect(normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      message: 'Quiero cambiar mi van y poner 2000 de down',
      chat_history_log: 'Benigno\nQuiero cambiar mi van y poner 2000 de down',
    })).toMatchObject({
      real_name: 'Benigno',
      vehicle_type: 'van',
      down_payment: '2000 + trade-in',
    });
  });

  it('recognizes RLX and the natural English phrase a thousand from Messenger', () => {
    expect(normalizeCollectorInput({
      source: 'action-pre-owned-cars',
      channel: 'messenger',
      real_name: 'Snott Harris',
      message: 'I can put down a thousand',
      chat_history_log: '2018 RLX\n4439903443\nI can put down a thousand',
    })).toMatchObject({
      vehicle_type: 'RLX 2018',
      down_payment: '1000',
    });
  });

  it.each([
    ['stafford', 'whatsapp', 'Sí', 'Carlos\nSUV\n1000'],
    ['fredericksburg', 'messenger', 'Yes, I financed a vehicle before', 'Toyota Tacoma\n1000'],
  ])('does not require a down payment after the vehicle is identified: %s', (source, channel, answer, history) => {
    const result = normalizeCollectorInput({
      source,
      channel,
      real_name: channel === 'messenger' ? 'QA Buyer' : '',
      phone: '+12405550123',
      message: answer,
      chat_history_log: history,
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    });

    expect(result).toMatchObject({
      down_payment: '',
      down_payment_amount: null,
      qualification_step: 'complete',
    });
  });

  it('does not add an Offlease minimum when the buyer denies previous financing', () => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      message: 'No',
      chat_history_log: 'Carlos\nTroca\n1000',
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    });

    expect(result).toMatchObject({
      down_payment: '',
      down_payment_sufficient: false,
      qualification_step: 'complete',
    });
    expect(result.missing_qualification).not.toContain('down_payment_minimum');
    expect(result.next_question).toBe('');
  });

  it('recovers an earlier standalone financing answer during GHL reconciliation and ignores a time range as down payment', () => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Josue Acosta',
      phone: '+12404229613',
      message: [
        'Josue Acosta',
        'Tengo mil en mano ahorita',
        'Si',
        'Este mes',
        'En la tarde',
        'Entre 1:30 a 5pm',
        'Okay',
        'SUV',
      ].join('\n'),
      chat_history_log: [
        'Josue Acosta',
        'Tengo mil en mano ahorita',
        'Si',
        'Este mes',
        'En la tarde',
        'Entre 1:30 a 5pm',
        'Okay',
        'SUV',
      ].join('\n'),
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    });

    expect(result).toMatchObject({
      down_payment: '',
      down_payment_amount: null,
    });
    expect(result.down_payment).not.toBe('5');
  });

  it.each([
    'Sí',
    'si podria',
    'Sí, podría',
    'si puedo',
    'con este monto',
    'Con este monto y no lo identifico',
    'ese monto sí lo tengo',
    'con esa cantidad está bien',
    'Claro',
    'Yes, I could',
    'I can finance 1000',
    'Anteriormente financié un vehículo',
  ])('keeps the common qualification complete for financing-history wording: %s', (answer) => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Buyer',
      phone: '+12405550123',
      message: answer,
      chat_history_log: 'Toyota Tacoma\n1000',
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    });

    expect(result).toMatchObject({
      down_payment: '',
      qualification_step: 'complete',
    });
  });

  it.each(['No', 'No, nunca', 'Nunca he financiado', 'No tengo historial de financiamiento'])('does not let a negative financing-history answer unlock $1000: %s', (answer) => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'QA Buyer',
      phone: '+12405550123',
      message: answer,
      chat_history_log: 'QA Buyer\nToyota Tacoma\n1000',
      previous_predicted_bot_question: 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?',
    });

    expect(result).toMatchObject({ previous_financing: 'no', down_payment_sufficient: false });
  });

  it('does not reuse a financing answer when the predictor is asking a different question', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Buyer',
      phone: '+12405550123',
      message: 'Sí',
      chat_history_log: 'Toyota Tacoma\n1000\nPara aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?\nSí',
      previous_predicted_bot_question: 'Te comento que el mínimo para este vehículo es de $3000. ¿Crees que podrías conseguir más?',
    });

    expect(result).toMatchObject({ previous_financing: '', down_payment: '', down_payment_sufficient: false });
    expect(result.next_question).toBe('');
  });

  it('repeats the financing-history question when the answer is unrelated', () => {
    const question = 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?';
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Buyer',
      phone: '+12405550123',
      message: 'Estoy en Baltimore',
      chat_history_log: 'Toyota Tacoma\n1000',
      previous_predicted_bot_question: question,
    });

    expect(result).toMatchObject({ previous_financing: '', down_payment: '', down_payment_sufficient: false, next_question: '' });
  });

  it('repeats the exact minimum question when the down-payment answer is unrelated', () => {
    const question = 'Te comento que el mínimo para este vehículo es de $3000. ¿Crees que podrías conseguir un poco más?';
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'QA Buyer',
      phone: '+12405550123',
      message: 'Estoy en Baltimore',
      chat_history_log: 'Toyota Tacoma\n1000',
      previous_predicted_bot_question: question,
    });

    expect(result).toMatchObject({ down_payment: '', down_payment_sufficient: false, next_question: '' });
  });

  it.each(['Bomltimo', 'baltimor', 'baltmore', 'baltimroe', 'balitmore', 'baltimre', 'baltimorre', 'baltimoro', 'balitmor', 'baltimo'])('canonicalizes Easterns Baltimore spelling variant %s for the locations lookup', (message) => {
    const result = normalizeCollectorInput({
      source: 'easterns',
      channel: 'messenger',
      real_name: 'Javier Rodriguez',
      phone: '+13016134765',
      vehicle_type: 'truck',
      message,
    });

    expect(result).toMatchObject({
      customer_location: 'Baltimore',
      qualification_step: 'complete',
      qualification_complete: true,
    });
  });

  it('does not apply fuzzy Baltimore correction outside Easterns', () => {
    expect(normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+13016134765',
      vehicle_type: 'truck',
      message: 'Bomltimo',
    }).customer_location).toBe('');
  });

  it('keeps Millersville outside the Baltimore fuzzy correction used by its round robin', () => {
    expect(normalizeCollectorInput({
      source: 'easterns-millersville',
      channel: 'messenger',
      phone: '+13016134765',
      vehicle_type: 'truck',
      message: 'Bomltimo',
    }).customer_location).toBe('');
  });

  it('normalizes structured image interpretation as ordinary inbound evidence', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Aldair M Denilson',
      message: "[image interpretation]\nvehicle: Chevrolet Equinox\nvehicle_type: SUV\ndocuments: I have my driver's license; I have proof of income",
    });

    expect(result).toMatchObject({
      vehicle_type: 'Chevrolet Equinox',
      identification: 'yes',
      has_income_proof: 'yes',
    });
    expect(result.documents).toContain('proof of income: yes');
  });

  it('removes image punctuation from a vehicle label', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      message: '[image interpretation]\nimage description: "bmw"',
    });

    expect(result.vehicle_type).toBe('BMW');
  });

  it('marks a phone-only inbound handoff as advisor contact without qualifying it as a vehicle', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Oscar Hernández',
      message: '804 546 1032',
    });

    expect(result).toMatchObject({
      phone: '+18045461032',
      vehicle_type: ADVISOR_HANDOFF_VEHICLE,
      qualification_step: 'vehicle_type',
      qualification_complete: false,
    });
    expect(result.missing_qualification).toContain('vehicle_type');
    expect(isAdvisorHandoffVehicle(result.vehicle_type)).toBe(true);
    expect(isQualificationComplete({
      real_name: 'Oscar Hernández',
      phone: '+18045461032',
      vehicle_type: ADVISOR_HANDOFF_VEHICLE,
      down_payment: '2000',
      purchase_timeline: 'today',
    })).toBe(false);
  });

  it('does not turn prices and mileage in a Messenger message into a phone', () => {
    expect(normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Negussie Gebremariam',
      message: 'Nissan Altima, Honda, Hyundai with price maximum $15,000\nMileage not more than 70,000',
      chat_history_log: 'Nissan Altima, Honda, Hyundai with price maximum $15,000\nMileage not more than 70,000',
    }).phone).toBe('');
  });

  it('accepts phone evidence only from messages inside the recent window', () => {
    const referenceAt = new Date('2026-09-12T15:00:00.000Z');
    expect(extractRecentMessagePhone([
      { body: 'My number is 240-681-5028', direction: 'inbound', occurred_at: '2026-09-12T14:59:00.000Z' },
      { body: 'I am still looking for a sedan', direction: 'inbound', occurred_at: '2026-09-12T15:00:00.000Z' },
    ], referenceAt)).toBe('+12406815028');
    expect(extractRecentMessagePhone([
      { body: 'My number is 240-681-5028', direction: 'inbound', occurred_at: '2026-07-12T14:59:00.000Z' },
      { body: 'I am still looking for a sedan', direction: 'inbound', occurred_at: '2026-09-12T15:00:00.000Z' },
    ], referenceAt)).toBe('');
    expect(extractRecentMessagePhone([
      { body: 'Call us at 240-681-5028', direction: 'outbound', occurred_at: '2026-09-12T14:59:00.000Z' },
    ], referenceAt)).toBe('');
  });

  it.each([
    ['7046990761', '+17046990761'],
    ['704-699-0761', '+17046990761'],
    ['(704) 699-0761', '+17046990761'],
    ['704 699 07 61', '+17046990761'],
    ['704.699.07.61', '+17046990761'],
    ['+1 704 699 07 61', '+17046990761'],
    ['1 (704) 699-0761', '+17046990761'],
  ])('normalizes phone formatting %s from an inbound message', (body, expected) => {
    const referenceAt = new Date('2026-10-07T02:05:00.000Z');
    expect(extractRecentMessagePhone([
      { body: `Es ${body}`, direction: 'inbound', occurred_at: '2026-10-07T02:03:56.142Z' },
    ], referenceAt)).toBe(expected);
  });

  it('accepts OCR phone evidence only when the capture explicitly labels it as a phone', () => {
    const referenceAt = new Date('2026-10-06T12:00:00.000Z');
    expect(extractRecentMessagePhone([
      {
        body: 'Phone Number: (804) 216-7319',
        direction: 'inbound',
        occurred_at: '2026-10-06T11:50:00.000Z',
        is_attachment_evidence: true,
      },
    ], referenceAt)).toBe('+18042167319');
    expect(extractRecentMessagePhone([
      {
        body: 'Número de teléfono\n+1-240-841-4199',
        direction: 'inbound',
        occurred_at: '2026-10-06T11:51:00.000Z',
        is_attachment_evidence: true,
      },
    ], referenceAt)).toBe('+12408414199');
  });

  it('rejects OCR numbers that are not explicitly labeled as phone numbers', () => {
    const referenceAt = new Date('2026-10-06T12:00:00.000Z');
    expect(extractRecentMessagePhone([
      {
        body: 'Passport OCR: ELMER GIOVANI SANCHEZ PALENCIA 19501047786',
        direction: 'inbound',
        occurred_at: '2026-10-06T11:50:00.000Z',
        is_attachment_evidence: true,
      },
      {
        body: 'ID number: 804-216-7319',
        direction: 'inbound',
        occurred_at: '2026-10-06T11:51:00.000Z',
        is_attachment_evidence: true,
      },
    ], referenceAt)).toBe('');
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
    expect(normalizeCollectorInput({ message: '500$' }).down_payment).toBe('');
  });

  it('keeps a vehicle year out of down payment when GHL supplies it in the vehicle field', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      vehicle_type: '2018 Honda Accord',
      down_payment: '2018',
      message: 'I can put 1000 down',
      chat_history_log: 'I can put 1000 down',
    });

    expect(result.vehicle_year).toBe(2018);
    expect(result.down_payment).toBe('');
    expect(result.down_payment_amount).toBe(null);
  });

  it('normalizes Spanish thousands and amount confirmations like the Julio conversation', () => {
    const transcript = [
      'Sedan',
      '5714439392',
      '1.500 está perfecto',
      'Este mes sería ideal',
      'Si tengo licencia de conducir y cuenta en el banco',
    ].join('\n');
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Julio Suarez Eguez',
      message: transcript,
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({
      phone: '+15714439392',
      vehicle_type: 'Sedan',
      down_payment: '1500',
      down_payment_amount: 1500,
      required_down_payment: 1500,
      down_payment_sufficient: true,
    });
  });

  it('normalizes the real Javier Accord typo and qualifies its 3000 down', () => {
    const transcript = [
      'Me gustaria financiar un auto con ustedes.',
      'Honda acoitd',
      '2409060016',
      '3 mil',
      'Esta semana',
      'Si',
    ].join('\n');
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Javier Baez Mercedes',
      message: transcript,
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({
      phone: '+12409060016',
      vehicle_type: 'Honda Accord',
      vehicle_category: 'sedan',
      required_down_payment: 1500,
      down_payment: '3000',
      down_payment_amount: 3000,
      down_payment_sufficient: true,
    });
  });

  it('inherits the amount from the last down-payment question when the buyer confirms it affirmatively', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Subaniel Salinas Torres',
      phone: '+12408311746',
      vehicle_type: 'Sedan',
      message: 'Sería. Bien eso. A solo. Ke trabajo de lunes a sábado',
      chat_history_log: 'Perfecto. Para este tipo de sedanes finos requerimos un enganche mínimo de $2000. ¿Con cuánto contarías para el enganche?\nSería. Bien eso. A solo. Ke trabajo de lunes a sábado',
    });
    expect(result).toMatchObject({ down_payment: '2000', down_payment_amount: 2000, required_down_payment: 1500, down_payment_sufficient: true });
  });

  it('does not turn a confirmation for another field into a down payment', () => {
    expect(normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      message: 'Sí, tengo cuenta bancaria',
      chat_history_log: 'Para este tipo de sedanes finos requerimos un enganche mínimo de $2000. ¿Con cuánto contarías para el enganche?\nSí, tengo cuenta bancaria',
    }).down_payment).toBe('');
  });

  it('inherits the minimum when the buyer confirms they can raise an insufficient down payment', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      message: 'Sí, puedo subirle',
      chat_history_log: 'Para esta troca el mínimo es $3000. ¿Crees que podrías conseguir un poco más?\nSí, puedo subirle',
    });
    expect(result.down_payment).toBe('3000');
  });

  it.each(['Con ese monto', 'Con este monto', 'Sí, con ese monto', 'Ese monto sí lo tengo', 'Con esa cantidad está bien'])('uses the predictor suggested minimum for a contextual amount confirmation: %s', (reply) => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'QA Customer',
      phone: '+15718351684',
      vehicle_type: 'Toyota Tacoma',
      message: reply,
      chat_history_log: reply,
      previous_predicted_bot_question: 'Perfecto. Para las trocas requerimos un enganche mínimo de $3000 (o pago de contado). ¿Con cuánto contarías tú para el enganche o cómo planeas tu pago?',
    });

    expect(result).toMatchObject({
      down_payment: '3000',
      down_payment_amount: 3000,
      required_down_payment: 3000,
      down_payment_sufficient: true,
      qualification_step: 'complete',
    });
  });

  it('does not treat an amount reference as a down confirmation without a predictor question', () => {
    expect(normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      vehicle_type: 'Toyota Tacoma',
      message: 'Con ese monto',
      chat_history_log: 'Con ese monto',
    })).toMatchObject({ down_payment: '' });
  });

  it.each([
    ['Sedan', 'Tengo 1000\nSí', 1500],
    ['SUV', 'Tengo 1500\nSí sí podría', 2000],
    ['minivan', 'Tengo 1500\nSi', 2000],
    ['Tacoma', 'Tengo 2500\nSi puedo conseguir solo que me den tiempo', 3000],
  ])('preserves the buyer amount without applying a minimum gate: %s', (vehicle, transcript, minimum) => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: vehicle,
      message: transcript,
      chat_history_log: transcript,
      previous_predicted_bot_question: `Te comento que el mínimo para este vehículo es de $${minimum}. ¿Crees que podrías conseguir un poco más?`,
    });

    expect(result).toMatchObject({
      down_payment: Number(transcript.match(/Tengo (\d+)/)?.[1]) >= 1500 ? transcript.match(/Tengo (\d+)/)?.[1] : '',
      down_payment_amount: Number(transcript.match(/Tengo (\d+)/)?.[1]) >= 1500 ? Number(transcript.match(/Tengo (\d+)/)?.[1]) : null,
      required_down_payment: minimum,
      down_payment_sufficient: false,
    });
  });

  it('preserves a larger explicit down payment when the buyer confirms the suggested minimum', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: 'Sedan',
      message: 'Tengo 10000\nSí',
      chat_history_log: 'Tengo 10000\nSí',
    });

    expect(result).toMatchObject({
      down_payment: '10000',
      down_payment_amount: 10000,
      required_down_payment: 1500,
      down_payment_sufficient: true,
    });
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
  ])('does not apply a minimum gate to varied down-payment replies: %s / %s / %s', (vehicle, amount, reply, minimum) => {
    const transcript = `${vehicle}\nTengo ${amount}\n${reply}`;
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: vehicle,
      message: transcript,
      chat_history_log: transcript,
      previous_predicted_bot_question: `Te comento que el mínimo para este vehículo es de $${minimum}. ¿Crees que podrías conseguir un poco más?`,
    });

    expect(result).toMatchObject({ down_payment: Number(amount) >= 1500 ? amount : '', down_payment_sufficient: false });
  });

  it('does not promote an affirmative turn when the predictor did not ask about increasing the down payment', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      phone: '+15405550123',
      vehicle_type: 'Sedan',
      message: 'Tengo 1000\nSí',
      chat_history_log: 'Tengo 1000\nSí',
    });

    expect(result).toMatchObject({ down_payment: '', down_payment_sufficient: false });
  });

  it('does not reuse an old down question after the bot moves to the timeline question', () => {
    expect(normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      message: 'Sí',
      chat_history_log: 'Para este vehículo requerimos un enganche mínimo de $2000. ¿Con cuánto cuentas?\nExcelente. ¿Para cuándo te gustaría comprar?',
    }).down_payment).toBe('');
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

  it('does not cross transcript lines and read a phone area code as down payment', () => {
    const result = normalizeCollectorInput({
      phone: '+14438626592',
      vehicle_type: 'SUV',
      chat_history_log: 'But I have down payment\n443 862-6592\nCould you do 700?',
      message: 'No I need a car like yesterday!!',
    });

    expect(result.phone).toBe('+14438626592');
    expect(result.down_payment).toBe('');
  });

  it('ignores a stale area-code-only down field but keeps an explicit down amount', () => {
    expect(normalizeCollectorInput({ phone: '+14438626592', vehicle_type: 'SUV', message: 'A small SUV', down_payment: '443' }).down_payment).toBe('');
    expect(normalizeCollectorInput({ phone: '+14438626592', message: 'I have 443 down' }).down_payment).toBe('');
  });

  it('stores the cash portion when the lead combines it with a trade-in', () => {
    expect(normalizeCollectorInput({ message: 'Dar unos 2000 y mi carro' }).down_payment).toBe('2000 + trade-in');
    expect(normalizeCollectorInput({ message: 'I can put $2500 down and my car' }).down_payment).toBe('2500 + trade-in');
    expect(normalizeCollectorInput({ message: 'My car is the trade-in', down_payment: '2500' }).down_payment).toBe('2500 + trade-in');
  });

  it('recovers Stafford WhatsApp economic-sedan wording during late reconciliation', () => {
    const transcript = [
      'Gabriel Centeno',
      'Algo económico',
      'Normal',
      '1,000 máximo',
      'Puerto Rico',
      'Si',
      'Esta semana semana me encuentro en Fayetteville NC',
      'En la tarde',
    ].join('\n');
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      message: transcript,
      chat_history_log: transcript,
      phone: '+19392249226',
      vehicle_type: ADVISOR_HANDOFF_VEHICLE,
    });

    expect(result.vehicle_type).toBe('Sedan');
    expect(result.phone).toBe('+19392249226');
    expect(result.down_payment).toBe('');
    expect(result.previous_financing).toBe('yes');
    expect(result.down_payment_sufficient).toBe(false);
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

    expect(result.vehicle_type).toBe('Sedan 2021');
    expect(result.down_payment).toBe('1000 + trade-in');
    expect(result.identification).toBe('yes');
    expect(result.has_income_proof).toBe('yes');
    expect(result.documents).toContain('proof of income: yes');
    expect(result.missing_qualification).toEqual([]);
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

  it.each([
    'I have a bank account',
    'Yes, I have a bank account',
    'Tengo cuenta bancaria',
  ])('normalizes a natural bank-account answer into bank_account: %s', (message) => {
    expect(normalizeCollectorInput({ message }).bank_account).toBe('yes');
  });

  it.each(['I have my passport', 'Tengo mi pasaporte'])('treats passport as valid identification: %s', (message) => {
    expect(normalizeCollectorInput({ message }).identification).toBe('yes');
  });

  it('accepts a trade-in as the down payment even without a cash amount', () => {
    expect(normalizeCollectorInput({ real_name: 'QA Customer', phone: '+13015550123', qualification_memory: 'make: Toyota; model: RAV4; down payment: trade-in; timeline: today; documents: driver license and proof of income; bank account: yes' })).toMatchObject({
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

  it('recognizes an explicit vehicle handoff as trade-in and keeps an explicit cash down amount', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Davila Davila',
      phone: '+12027796699',
      message: 'Quisiera ver si puedo entregar mi vehículo y poner $2000 de enganche.',
    });
    expect(result.down_payment).toBe('2000 + trade-in');
    expect(result.vehicle_type).toBe('');
    expect(result.real_name).toBe('Davila Davila');
  });

  it('scores the full transcript so narrative Chevrolet text cannot replace an explicit Camaro request', () => {
    const transcript = [
      'Hola, variedad en chevrolet maneja, busco uno en 4 o 6 cilindros con modelo 2lt',
      'Oh un chevrolet según su anuncio manejan con estética deportiva',
      'Un suv',
      '8642651776',
      'Es mi numero',
      'Si me interesa un camaro con paquete 2lt del año no estoy tan especial puede ser 2017 en adelante',
      'Claro es lo de menos, igual me gustaria hacer la compra en efectivo',
      'lo haria en esta semana, igual puedo esperar algunos dias la cosa que me guste el auto',
    ].join('\n');
    const result = normalizeCollectorInput({ channel: 'messenger', real_name: 'Gabriel Gonzalez', message: 'Con gusto!', chat_history_log: transcript });
    expect(result.vehicle_type).toBe('Chevrolet Camaro 2LT 2017');
    expect(result.purchase_timeline).toBe('esta semana');
  });

  it('normalizes the reproduced Messenger wording "para la siguiente semana" as purchase timing', () => {
    const transcript = [
      'Holaa',
      'Un sedan un honda civic sport',
      '2407293614',
      'Me parece bien si cuento con eso',
      'Ahorita por motivo de viaje sería para la siguiente semana',
    ].join('\n');

    expect(normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Garcia JDaniel',
      chat_history_log: transcript,
      message: 'Ahorita por motivo de viaje sería para la siguiente semana',
    })).toMatchObject({
      phone: '+12407293614',
      vehicle_type: 'Honda Sedan',
      purchase_timeline: 'próxima semana',
    });
  });

  it.each([
    ['Just looking', 'exploring options'],
    ['Solo mirar por el momento', 'explorando opciones'],
  ])('preserves non-committal purchase intent from the reproduced transcript: %s', (message, expected) => {
    expect(normalizeCollectorInput({ message }).purchase_timeline).toBe(expected);
  });

  it('does not lose earlier qualification facts when a later poll only contains vehicle and phone', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Alynn Campos',
      phone: '+17176989246',
      message: 'Sedan\n7176989246',
      chat_history_log: 'Sedan\n7176989246',
      qualification_memory: 'real_name: Alynn Campos; vehicle: Sedan; timeline: este mes; documents: identification: yes; proof of income: yes; bank account: yes',
    });

    expect(result).toMatchObject({
      phone: '+17176989246',
      vehicle_type: 'Sedan',
      purchase_timeline: 'este mes',
      identification: 'yes',
      has_income_proof: 'yes',
      bank_account: 'yes',
    });
    expect(result.qualification_memory).toContain('timeline: este mes');
    expect(result.qualification_memory).toContain('bank account: yes');
  });

  it('normalizes Hummer vehicle text and immediate timing from the reproduced inbound wording', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Ceddrick Moody',
      message: 'What vehicles are eligible?\nHummer sut\nI could pay for it cash\nNow if possible',
    });
    expect(result.vehicle_type).toBe('Hummer sut');
    expect(result.down_payment).toBe('Pagara en cash / de contado');
    expect(result.purchase_timeline).toBe('today');
  });

  it('accepts a standalone explicit make/model reply from the reproduced Davila conversation', () => {
    expect(normalizeCollectorInput({ message: 'Una Toyota Trail Hunter' }).vehicle_type).toBe('Toyota Trail Hunter');
  });

  it('keeps the make/model from the Sarah Saints Messenger transcript', () => {
    const transcript = [
      'Quiero financiar un auto',
      'Este caro menos de 8K',
      '2014 Honda Civic EX',
      '5716946924',
    ].join('\n');

    expect(normalizeCollectorInput({ channel: 'messenger', real_name: 'Sarah Saints', chat_history_log: transcript, message: '5716946924' })).toMatchObject({
      vehicle_type: 'Honda Civic EX 2014',
      phone: '+15716946924',
    });
  });

  it('normalizes the misspelled Corolla from the Milciades Hernandez Messenger transcript', () => {
    const transcript = [
      'Me gustaria financiar un auto',
      'Corola',
      '571.513.29.79',
    ].join('\n');

    expect(normalizeCollectorInput({ channel: 'messenger', real_name: 'Milciades Hernandez', message: '571.513.29.79', chat_history_log: transcript })).toMatchObject({
      vehicle_type: 'Corolla',
      phone: '+15715132979',
    });
  });

  it.each([
    ['Corola', 'Corolla'],
    ['civc', 'Civic'],
    ['Tacma', 'Tacoma'],
    ['tacomo', 'Tacoma'],
    ['Tecoma', 'Tacoma'],
    ['Tacomas', 'Tacoma'],
    ['Tacomos', 'Tacoma'],
    ['Tacmas', 'Tacoma'],
    ['Tecomas', 'Tacoma'],
    ['suvaru sti', 'Subaru STI'],
    ['Rav 4', 'RAV4'],
    ['4 runner', '4Runner'],
    ['for runner', '4Runner'],
    ['for runer', '4Runner'],
  ])('canonicalizes a controlled model spelling variant: %s', (message, expected) => {
    expect(normalizeCollectorInput({ message }).vehicle_type).toBe(expected);
  });

  it('normalizes an English HEMI Durangos request to Dodge Durango', () => {
    const result = normalizeCollectorInput({
      source: 'koons-culpeper',
      channel: 'messenger',
      real_name: 'Ryan Claddy',
      phone: '+14342701737',
      message: 'They have that',
      chat_history_log: [
        'Do u have any hemi Durangos down there',
        '4342701737',
        'Maybe like 1k or so',
        'Need to no if it is a hemi or not',
        'Next Friday',
        'They have that',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      vehicle_type: 'Dodge Durango',
      qualification_complete: true,
    });
    expect(result.vehicle_type).not.toBe(ADVISOR_HANDOFF_VEHICLE);
    expect(result.missing_qualification).not.toContain('vehicle_type');
  });

  it.each(['Quiero financiar un auto', 'Este carro menos de 8K', 'Más información', '2014'])('does not promote non-vehicle text to vehicle_type: %s', (message) => {
    expect(normalizeCollectorInput({ vehicle_type: message, message }).vehicle_type).toBe('');
  });

  it.each([
    ['Dodge Charger', 'Dodge Charger'],
    ['Dodge Challenger', 'Dodge Challenger'],
    ['Toyota Tacoma', 'Toyota Tacoma'],
    ['ban', 'van'],
    ['a family van', 'van'],
    ['a 7 passenger van', 'van'],
    ['Tendrá alguna ban con Rampla para transporte de adulto mayor', 'van'],
    ['Ando buscando algo familiar para 7 pasajeros', 'van'],
    ['camión', 'truck'],
    ['camioneta', 'truck'],
    ['Truk', 'truck'],
  ])('normalizes common dealer vehicle request: %s', (message, expected) => {
    expect(normalizeCollectorInput({ message }).vehicle_type).toBe(expected);
  });

  it('does not treat the Spanish verb phrase "van a llamar" as a vehicle', () => {
    const phrase = 'Para qué me pidieron el número si no me van a llamar';
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      phone: '+18043076139',
      message: phrase,
      chat_history_log: ['Tacoma', 'Tienen tacomas', '8043076139', '2000', phrase].join('\n'),
      qualification_memory: 'real_name: Adil Paredes; vehicle: Tacoma; down payment: 2000',
      vehicle_type: 'Tacoma',
      down_payment: '2000',
    });

    expect(result).toMatchObject({
      vehicle_type: 'Tacoma',
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment_sufficient: false,
    });
  });

  it('keeps Arlington plural troca intent and ignores the phone line as down payment', () => {
    const transcript = ['Que trocas tiene', '540-746-5136'].join('\n');
    const result = normalizeCollectorInput({
      source: 'arlington',
      channel: 'messenger',
      real_name: 'Gera Delgado',
      phone: '+15407465136',
      message: transcript,
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({
      vehicle_type: 'truck',
      down_payment: '',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('replays Alonzo Gerber’s Arlington Messenger vehicle answer as a routable Tacoma', () => {
    const transcript = [
      'Hola',
      'Una tacomo manual de 4 puerta',
      '2402740544',
      'Con 5000',
      'Mandame la direccion para yegar ber los beiculos',
    ].join('\n');

    expect(normalizeCollectorInput({
      source: 'arlington',
      channel: 'messenger',
      real_name: 'Alonzo Gerber',
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

  it('replays the noisy plural Toyota Tacoma answer from Action Cars as a routable truck', () => {
    const transcript = [
      'Toyotas Tacomas. Tienen',
      'Me puedes mandar. Las fotos. Para verlas. Porfa.',
      '703 3405401',
      'Me. Puedes. Mandarme. Las fotos para Verla’s. Porfa',
    ].join('\n');

    expect(normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Fredy Bautista',
      phone: '+17033405401',
      chat_history_log: transcript,
      message: 'Me. Puedes. Mandarme. Las fotos para Verla’s. Porfa',
      vehicle_type: 'Quiere hablar con un asesor',
    })).toMatchObject({
      phone: '+17033405401',
      vehicle_type: 'Toyota Tacoma',
      vehicle_category: 'truck',
    });
  });

  it('replays the exact Jaimen Cruz GHL inbound transcript as a routable 4Runner lead', () => {
    const transcript = [
      'Holaa ando buscando una for runer 4x4 2010 ho 2015',
      '8046532943',
      'No se como trabajan ustedes',
    ].join('\n');

    expect(normalizeCollectorInput({
      source: 'koons-culpeper',
      channel: 'messenger',
      real_name: 'Jaimen Cruz',
      chat_history_log: transcript,
      message: 'No se como trabajan ustedes',
    })).toMatchObject({
      real_name: 'Jaimen Cruz',
      phone: '+18046532943',
      vehicle_type: '4Runner 2010',
    });
  });

  it('replays Jose Luis Salcedo Toyota Runner wording as a routable 4Runner lead', () => {
    const transcript = [
      'Buenos días, bueno quería que me diera una información para ver si tenían Toyota Runner del 2016 o 217-1819 20 alguno de esos modelos',
      '8435311632',
    ].join('\n');

    expect(normalizeCollectorInput({
      source: 'easterns-frederick',
      channel: 'messenger',
      real_name: 'Jose Luis Salcedo',
      phone: '+18435311632',
      chat_history_log: transcript,
      message: '8435311632',
    })).toMatchObject({
      real_name: 'Jose Luis Salcedo',
      phone: '+18435311632',
      vehicle_type: 'Toyota 4Runner 2016',
      vehicle_year: 2016,
    });
  });

  it('replays Rosali Saravia raw4 wording as a routable RAV4 lead', () => {
    const transcript = [
      'Estoy buscando un raw4',
      '202 5092809',
      'Es mi número de cell',
      'Hablo español',
      'En laurel, Maryland',
    ].join('\n');

    expect(normalizeCollectorInput({
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
      customer_location: 'Laurel',
    });
  });

  it('replays the spoken rava variant with its vehicle year', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Nati de Leon',
      phone: '+14847193424',
      message: 'Una rava de 2020',
    });

    expect(result).toMatchObject({
      real_name: 'Nati de Leon',
      phone: '+14847193424',
      vehicle_type: 'RAV4 2020',
      vehicle_year: 2020,
      qualification_complete: true,
    });
  });

  it('replays the exact Luis A Sandoval GHL inbound transcript as a routable Tacoma lead', () => {
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

    expect(normalizeCollectorInput({
      source: 'koons-fred',
      channel: 'messenger',
      real_name: 'Dónde Queda Moon',
      chat_history_log: transcript,
      message: 'Ya le llamé y no entra la llamada',
    })).toMatchObject({
      phone: '+19198797239',
      vehicle_type: 'Tacoma',
      down_payment: '1000',
    });
  });

  it.each([
    ['1000', '1000'],
    ['2000', '2000'],
    ['3000', '3000'],
    ['3 mil', '3000'],
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
  ])('normalizes the down payment wording %s', (message, expected) => {
    expect(normalizeCollectorInput({ message: `Tengo ${message} para el enganche` }).down_payment).toBe(expected);
  });

  it('keeps the full "Tengo 2 mil" amount when the transcript also contains a phone', () => {
    const result = normalizeCollectorInput({
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
    });
  });

  it('keeps the latest down amount when a buyer first gives a lower amount', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Angel Fuentes',
      message: 'Esta bien. Gracias',
      chat_history_log: [
        'Buenas tardes. K requisitos pides para fonanciar una troca?',
        'Solo cuento con $1700 ahora',
        'Lo Maximo k puedo aseguran son $2000',
        'Esta bien. Gracias',
      ].join('\n'),
    });
    expect(result).toMatchObject({
      vehicle_type: 'truck',
      down_payment: '2000',
      down_payment_amount: 2000,
      required_down_payment: 3000,
      down_payment_sufficient: false,
    });
  });

  it('normalizes common Whisper Spanish phonetics from a three-row audio answer', () => {
    const result = normalizeCollectorInput({
      channel: 'whatsapp',
      message: 'Estoy interesado en tres filas de asiento, bien sea odisea o una paila o tajo.',
    });
    expect(result.vehicle_type).toBe('Odyssey');
  });

  it('keeps the cash portion when vehicle-change language is combined with a payment', () => {
    expect(normalizeCollectorInput({ message: 'Quiero cambiar mi vehículo y poner $2,000' }).down_payment).toBe('2000 + trade-in');
    expect(normalizeCollectorInput({ down_payment: 'cambio mi auto + 2K' }).down_payment).toBe('2000 + trade-in');
  });

  it('combines a trade-in and cash amount when both are stored in memory', () => {
    expect(normalizeCollectorInput({ real_name: 'QA Customer', phone: '+13015550123', qualification_memory: 'make: Honda; model: Civic; down payment: trade-in + 2K; timeline: today; documents: ID and proof of income; bank account: yes' })).toMatchObject({
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
    expect(result.next_question).toBe("What's the best phone number to reach you?");
    expect(result.qualification_progress).toMatchObject({
      step: 'phone',
      predicted_bot_question: "What's the best phone number to reach you?",
      language: 'en',
    });
  });

  it.each([
    ['en', 'I am looking for a Mustang', "What's the best phone number to reach you?"],
    ['es', 'Estoy buscando un Mustang', '¿Cuál es el mejor número para contactarte?'],
  ])('predicts the next qualification step and bot question in %s', (language, message, question) => {
    const result = normalizeCollectorInput({ channel: language === 'en' ? 'whatsapp' : 'whatsapp', message });
    expect(result.qualification_progress).toMatchObject({
      step: 'phone',
      predicted_bot_question: question,
      language,
      confidence: 0.95,
      evidence: 'normalized_fields',
    });
  });

  it('predicts the down-payment step after a vehicle and phone response', () => {
    const result = normalizeCollectorInput({ channel: 'whatsapp', message: 'My name is Taylor QA\nI am looking for a Mustang\n+1 (804) 309-2531' });
    expect(result).toMatchObject({ vehicle_type: 'Mustang', phone: '+18043092531' });
    expect(result.qualification_progress).toMatchObject({
      step: 'complete',
      last_answered_field: 'phone',
      predicted_bot_question: '',
    });
  });

  it('uses a Spanish predicted question for the next missing field', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Cliente QA',
      phone: '+18043092531',
      message: 'Estoy buscando un Mustang',
    });
    expect(result.qualification_progress).toMatchObject({
      step: 'complete',
      last_answered_field: 'phone',
      predicted_bot_question: '',
      language: 'es',
    });
  });

  it('uses the common vehicle-and-phone order without an AI call', () => {
    const first = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'Cliente Offlease',
      message: 'Busco una Toyota Corolla',
    });
    expect(first.qualification_progress).toMatchObject({ step: 'phone', predicted_bot_question: '¿Cuál es el mejor número para contactarte?' });

    const second = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'Cliente Offlease',
      phone: '+18045550123',
      message: 'Busco una Toyota Corolla y tengo 1000 para el enganche',
    });
    expect(second).toMatchObject({ vehicle_type: 'Toyota Corolla', down_payment: '', down_payment_sufficient: false });
    expect(second.qualification_progress).toMatchObject({ step: 'complete' });
    expect(second.next_question).toBe('');
  });

  it('relates Easterns location to the location step and skips it when already mentioned', () => {
    expect(normalizeCollectorInput({ source: 'easterns', channel: 'messenger', real_name: 'QA Customer', message: 'I want an SUV' }).qualification_progress).toMatchObject({
      step: 'customer_location',
      predicted_bot_question: 'What city are you located in?',
    });
    expect(normalizeCollectorInput({ source: 'easterns', channel: 'messenger', real_name: 'QA Customer', message: 'I want an SUV in Laurel' }).qualification_progress.step).toBe('phone');
  });

  it('uses the Stafford name-first flow while treating the WhatsApp phone as known', () => {
    expect(normalizeCollectorInput({ source: 'stafford', channel: 'whatsapp', phone: '+18045550123', message: 'Carlos' }).qualification_progress).toMatchObject({
      step: 'vehicle_type',
      predicted_bot_question: '¿Qué vehículo estás buscando?',
    });
  });

  it('keeps no-down as a known flexible-dealer answer', () => {
    expect(normalizeCollectorInput({ source: 'easterns', channel: 'messenger', real_name: 'Cliente', message: 'No tengo pago inicial' })).toMatchObject({
      down_payment: 'No down payment',
      qualification_step: 'vehicle_type',
    });
  });

  it('allows cash payment to bypass the Offlease down minimum', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'Cliente QA',
      phone: '+15405550123',
      message: 'Busco una Tacoma y voy a pagar de contado',
    });
    expect(result).toMatchObject({
      down_payment: 'Pagara en cash / de contado',
      vehicle_category: 'truck',
      required_down_payment: 3000,
      down_payment_sufficient: true,
      qualification_step: 'complete',
      qualification_complete: true,
    });
  });

  it('preserves the vehicle description and identifies the purchase timeline', () => {
    const result = normalizeCollectorInput({ message: 'I want a Toyota RAV4 SUV this week' });
    expect(result.vehicle_type).toContain('Toyota RAV4 SUV');
    expect(result.purchase_timeline).toBe('this week');
  });

  it.each([
    ['Tiene Mustang', 'Mustang'],
    ['Estoy buscando un Mustang', 'Mustang'],
    ['I am looking for a Ford Explorer', 'Ford Explorer'],
  ])('classifies a vehicle statement as vehicle data and not a real name: %s', (message, expected) => {
    const result = normalizeCollectorInput({ message, real_name: message });
    expect(result.real_name).toBe('');
    expect(result.vehicle_type).toBe(expected);
  });

  it('ignores the Easterns advertising phrase when it arrives in vehicle_type', () => {
    expect(normalizeCollectorInput({ message: 'financiar con Easterns', vehicle_type: 'financiar con Easterns' }).vehicle_type).toBe('');
  });

  it('removes the known GHL custom-code plus AI concatenation from vehicle values', () => {
    expect(normalizeCollectorInput({ vehicle_type: 'Toyota hilanderVehicle: Toyota hilanderToyota hilander' }).vehicle_type)
      .toBe('Toyota Highlander');
  });

  it('stores document answers as structured text and proposes the next question', () => {
    const result = normalizeCollectorInput({ message: 'Yes, I have my ID' });
    expect(result.documents).toContain('identification: yes');
    expect(result.has_identification).toBe('yes');
    expect(result.next_question).toBe('What vehicle are you looking for?');
  });

  it('captures affirmative document answers before the document name', () => {
    const result = normalizeCollectorInput({
      message: "Yes, I have my driver's license and proof of income",
      down_payment: ',',
    });
    expect(result.documents).toContain('identification: yes');
    expect(result.documents).toContain('proof of income: yes');
    expect(result.down_payment).toBe('');
    expect(result.next_question).toBe('What vehicle are you looking for?');
  });

  it('preserves an explicit negative proof-of-income answer', () => {
    const result = normalizeCollectorInput({
      identification: 'yes',
      documents: 'identification: yes, proof of income: no',
    });

    expect(result.has_identification).toBe('yes');
    expect(result.has_income_proof).toBe('no');
    expect(result.documents).toContain('proof of income: no');
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

    expect(normalizeCollectorInput({ message: 'Para ya' }).purchase_timeline).toBe('hoy');
  });

  it('keeps a standalone amount when a later inbound reply also contains its timeline', () => {
    const result = normalizeCollectorInput({
      message: '2000\nesta semana',
      chat_history_log: 'busco un Mustang\n2000\nesta semana',
      real_name: 'Late Repair',
    });
    expect(result.down_payment).toBe('2000');
    expect(result.purchase_timeline).toBe('esta semana');
    expect(result.vehicle_type).toBe('Mustang');
  });

  it('does not turn a callback hour into a down payment after a valid earlier amount', () => {
    const transcript = [
      'RAV4',
      '1500',
      'Está semana',
      '¿A qué hora te queda mejor recibir la llamada?',
      '10',
      '10',
    ].join('\n');

    expect(normalizeCollectorInput({ message: transcript, chat_history_log: transcript })).toMatchObject({
      vehicle_type: 'RAV4 2010',
      down_payment: '1500',
    });
  });

  it('ignores a callback hour when reconciliation provides inbound messages only', () => {
    const transcript = ['RAV4', '1500', 'Está semana', 'Si tengo cuenta', 'Pasaporte nomas', '10', '10'].join('\n');

    expect(normalizeCollectorInput({ message: transcript, chat_history_log: transcript })).toMatchObject({
      vehicle_type: 'RAV4 2010',
      down_payment: '1500',
    });
  });

  it.each([
    ['1000', '1000'],
    ['2000', '2000'],
    ['3000', '3000'],
  ])('keeps standalone cash amount %s as down payment', (message, expected) => {
    expect(normalizeCollectorInput({ message }).down_payment).toBe(expected);
  });

  it.each(['2006', '2018', '2019', '2025', '2026'])('does not classify a standalone vehicle year as down payment: %s', (message) => {
    expect(normalizeCollectorInput({ message }).down_payment).toBe('');
  });

  it('does not classify a vehicle year range as down payment', () => {
    const result = normalizeCollectorInput({
      message: 'Que trocas tiene\n2006 - 2026',
      chat_history_log: 'Que trocas tiene\n2006 - 2026',
    });

    expect(result).toMatchObject({
      vehicle_type: 'truck 2006',
      vehicle_year: 2006,
      down_payment: '',
    });
  });

  it('separates a vehicle year from down payment when only the vehicle is mentioned', () => {
    expect(normalizeCollectorInput({ message: 'Me interesa la F150 2018' })).toMatchObject({
      vehicle_type: 'F-150 2018',
      vehicle_year: 2018,
      down_payment: '',
    });
  });

  it.each(['05', '15', '26'])('treats a standalone Stafford year reply as a vehicle year, not down payment: %s', (year) => {
    expect(normalizeCollectorInput({ message: `Civic\n${year}`, chat_history_log: `Civic\n${year}` })).toMatchObject({
      vehicle_type: `Civic ${2000 + Number(year)}`,
      vehicle_year: 2000 + Number(year),
      down_payment: '',
    });
  });

  it('does not treat a two-digit year rendered beside down as a payment', () => {
    expect(normalizeCollectorInput({ message: 'Jaime Civic, 15 de down', chat_history_log: 'Jaime Civic, 15 de down' })).toMatchObject({
      vehicle_type: 'Civic 2015',
      vehicle_year: 2015,
      down_payment: '',
    });
  });

  it('keeps a vehicle year separate from an explicit intermediate down payment', () => {
    expect(normalizeCollectorInput({ message: 'Quiero el Honda Civic 2020 y tengo 2500 de down' })).toMatchObject({
      vehicle_type: 'Honda Civic 2020',
      vehicle_year: 2020,
      down_payment: '2500',
      down_payment_amount: 2500,
    });
  });

  it('accepts an intermediate down payment with Spanish payment context', () => {
    expect(normalizeCollectorInput({ message: 'Tengo 1800 para dar de cuota inicial' })).toMatchObject({
      vehicle_year: null,
      down_payment: '1800',
      down_payment_amount: 1800,
    });
  });

  it('separates a vehicle year from a second explicit down payment', () => {
    expect(normalizeCollectorInput({ message: 'Busco carro 2008 con 2000 down' })).toMatchObject({
      vehicle_year: 2008,
      down_payment: '2000',
      down_payment_amount: 2000,
    });
  });

  it('does not interpret the final digits of a phone reply as a vehicle year', () => {
    const result = normalizeCollectorInput({
      source: 'koons-culpeper',
      channel: 'messenger',
      real_name: 'Benito Ruiz',
      phone: '+17173981944',
      message: 'camioneta',
      chat_history_log: [
        'cual es la direccion y que tipo de trocas tienen boy a ir mañana viernes por la tarde',
        '717 398 1944',
        'camioneta',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      real_name: 'Benito Ruiz',
      phone: '+17173981944',
      vehicle_type: 'truck',
      vehicle_year: null,
    });
  });

  it('extracts a declared personal name from a Stafford conversation', () => {
    expect(normalizeCollectorInput({ message: 'Elias alvarado' }).real_name).toBe('Elias Alvarado');
  });

  it('skips a greeting and extracts the following simple name from the Stafford WhatsApp transcript', () => {
    const result = normalizeCollectorInput({
      channel: 'whatsapp',
      phone: '+19297563553',
      message: 'Saludos\nAmin\nBusco carro del 2019 en adelante\nSedan\n500$',
      chat_history_log: 'Saludos\nAmin\nBusco carro del 2019 en adelante\nSedan\n500$',
    });

    expect(result.real_name).toBe('Amin');
    expect(result.vehicle_type).toBe('Sedan 2019');
    expect(result.down_payment).toBe('');
    expect(result.qualification_step).toBe('complete');
    expect(result.qualification_progress.predicted_bot_question).toBe('');
  });

  it('does not promote a location question and combines a colloquial truck with its Ford make', () => {
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
    const result = normalizeCollectorInput({
      channel: 'whatsapp',
      phone: '+19842986568',
      message: transcript,
      chat_history_log: transcript,
      qualification_memory: 'documents: identification: yes; proof of income: yes',
    });

    expect(result.real_name).toBe('Javier Ayala');
    expect(result.vehicle_type).toBe('Ford Truck');
    expect(result.down_payment).toBe('1000');
    expect(result.purchase_timeline).toBe('esta semana');
    expect(result.identification).toBe('yes');
    expect(result.has_income_proof).toBe('yes');
  });

  it('extracts a down payment from transcribed cuento con phrasing with punctuation', () => {
    const transcript = [
      'Quiero. Una. Camioneta.',
      'Cuento. Con. 1500.',
      'Mi numero es 7576728541',
    ].join('\n');
    const result = normalizeCollectorInput({
      channel: 'messenger',
      message: transcript,
      chat_history_log: transcript,
    });

    expect(result.vehicle_type).toBe('truck');
    expect(result.phone).toBe('+17576728541');
    expect(result.down_payment).toBe('1500');
    expect(result.down_payment_amount).toBe(1500);
    expect(result.down_payment_sufficient).toBe(false);
  });

  it('normalizes carro económico to Sedan for WhatsApp and Messenger contacts', () => {
    expect(normalizeCollectorInput({
      channel: 'whatsapp',
      message: 'Busco un carro economico para esta semana',
    }).vehicle_type).toBe('Sedan');

    expect(normalizeCollectorInput({
      channel: 'messenger',
      message: 'Busco un carro economico para esta semana',
    }).vehicle_type).toBe('Sedan');
  });

  it.each([
    ['carros económicos', 'Sedan'],
    ['economical car', 'Sedan'],
    ['affordable car', 'Sedan'],
    ['Camaros', 'Camaro'],
  ])('normalizes vehicle wording %s to %s', (message, expected) => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      message,
      vehicle_type: message,
      chat_history_log: message,
    });

    expect(result.vehicle_type).toBe(expected);
  });

  it.each([
    ['U coche 🚗 pequeño', 'Sedan'],
    ['un coche pekeno', 'Sedan'],
    ['auto chico', 'Sedan'],
  ])('normalizes compact-car wording %s to %s', (message, expected) => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      message,
      vehicle_type: ADVISOR_HANDOFF_VEHICLE,
    });

    expect(result.vehicle_type).toBe(expected);
    expect(result.qualification_memory).toContain(`vehicle: ${expected}`);
    expect(result.missing_qualification).not.toContain('vehicle_type');
  });

  it('normalizes Spanish turismo passenger wording to Sedan', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      message: 'Pues un turismo para viajar al trabajo',
      vehicle_type: ADVISOR_HANDOFF_VEHICLE,
    });

    expect(result).toMatchObject({
      vehicle_type: 'Sedan',
      vehicle_category: 'sedan',
    });
    expect(result.missing_qualification).not.toContain('vehicle_type');
  });

  it('replays Orlando Jones Jr. without losing the suffix, small-car category, or down payment', () => {
    const result = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Orlando Jones Jr.',
      phone: '+14102270075',
      message: "I’m looking for a small car that I can use to run back-and-forth to DC on a daily basis from Maryland\nI’m looking for a car $10,000 or less I’ll put down at least 2000 if not pay for the whole thing upfront",
    });

    expect(result).toMatchObject({
      real_name: 'Orlando Jones Jr',
      phone: '+14102270075',
      vehicle_type: 'Sedan',
      vehicle_year: null,
      down_payment: '2000',
    });
    expect(normalizeCollectorInput({ source: 'action-cars', channel: 'messenger', message: 'Busco un carro pequeño' }).vehicle_type).toBe('Sedan');
  });

  it('extracts a declared personal name from the complete inbound transcript', () => {
    const result = normalizeCollectorInput({
      real_name: 'EliasJosue 🕊Mnegra',
      message: '*Headline:* Financiamiento interno! Quiero financiar un auto!\nElias alvarado\nAun auto económico para el trabajo',
      chat_history_log: '*Headline:* Financiamiento interno! Quiero financiar un auto!\nElias alvarado\nAun auto económico para el trabajo',
    });
    expect(result.real_name).toBe('Elias Alvarado');
    expect(result.vehicle_type).toBe('Sedan');
  });

  it('uses the Messenger contact name as real_name', () => {
    expect(normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Hay Les Aviso',
      message: 'Que requisitos necesito',
    }).real_name).toBe('Hay Les Aviso');
  });

  it('keeps the decorated Messenger profile name ahead of a contaminated payment answer', () => {
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

    expect(normalizeCollectorInput({
      source: 'arlington',
      channel: 'messenger',
      real_name: 'Me Pagan Cheque',
      contact_name: 'Andrea⚘️',
      message: 'Licencia y pasaporte',
      chat_history_log: transcript,
    }).real_name).toBe('Andrea');
  });

  it('uses only a declared chat name for WhatsApp', () => {
    expect(normalizeCollectorInput({
      channel: 'whatsapp',
      real_name: 'EliasJosue 🕊Mnegra',
      message: 'Me llamo Elias Alvarado',
    }).real_name).toBe('Elias Alvarado');
    expect(normalizeCollectorInput({
      channel: 'whatsapp',
      real_name: 'EliasJosue 🕊Mnegra',
      message: 'Estoy buscando un Mustang',
    }).real_name).toBe('');
  });

  it('normalizes a complete Messenger conversation using the chat phone', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Emma Oertly',
      phone: '',
      chat_history_log: 'Busco una Honda Civic\nMi número es 804-970-1204\nPuedo dar 2000 de down\nLo compraré este mes\nTengo mi licencia y estados de cuenta, y sí tengo cuenta bancaria\nGracias',
    });

    expect(result).toMatchObject({
      real_name: 'Emma Oertly',
      phone: '+18049701204',
      vehicle_type: 'Honda Civic',
      down_payment: '2000',
      purchase_timeline: 'este mes',
      has_income_proof: 'yes',
    });
  });

  it('normalizes a complete WhatsApp conversation using the registered phone and declared name', () => {
    const result = normalizeCollectorInput({
      channel: 'whatsapp',
      real_name: 'EliasJosue 🕊Mnegra',
      phone: '+18049701205',
      chat_history_log: 'I am looking for a Honda Civic\nI can put 2000 down\nI will buy this month\nI have my driver license and bank statements, and I have a bank account\nMy name is Elias Alvarado\nThank you',
    });

    expect(result).toMatchObject({
      real_name: 'Elias Alvarado',
      phone: '+18049701205',
      vehicle_type: 'Honda Civic',
      down_payment: '2000',
      purchase_timeline: 'this month',
      has_income_proof: 'yes',
    });
  });

  it('does not use WhatsApp ad metadata as a name and maps a family passenger request to a van', () => {
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

    expect(normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Me Interrwa Lo del',
      phone: '+14434202361',
      vehicle_type: ADVISOR_HANDOFF_VEHICLE,
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

  it('does not use a Stafford WhatsApp vehicle label as the buyer name', () => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: 'Un Ford Explorer Estoppel',
      real_name: 'Un Ford Explorer Estoppel',
      phone: '+17712024963',
      message: 'Ford Explorer',
      chat_history_log: 'Ford Explorer\n1000\nEstoy en Stafford',
    });

    expect(result.real_name).toBe('');
    expect(result.vehicle_type).toBe('Ford Explorer');
  });

  it('does not use a vehicle statement as an Arlington buyer name', () => {
    expect(normalizeCollectorInput({
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

  it('uses the latest vehicle and Stafford WhatsApp phone when the buyer changes vehicle', () => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Juan Jose Castillo',
      phone: '+19107093650',
      chat_history_log: [
        'Juan Jose Castillo',
        'Estoy interesado en un Honda CRV 2014',
        'O un Honda Civic 2012',
        'Un sedan',
        '1500',
      ].join('\n'),
      message: '1500',
    });

    expect(result).toMatchObject({
      real_name: 'Juan Jose Castillo',
      phone: '+19107093650',
      vehicle_type: 'sedan 2014',
      down_payment: '1500',
      required_down_payment: 1500,
      down_payment_sufficient: true,
    });
  });

  it('uses the latest vehicle and Messenger phone for Fredericksburg', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: 'messenger',
      real_name: 'Juan Jose Castillo',
      chat_history_log: [
        'Estoy interesado en una Honda CRV 2014',
        'O un Honda Civic 2012',
        'Un sedan',
        '804-970-1204',
        'Tengo 1500 para el down',
      ].join('\n'),
      message: 'Tengo 1500 para el down',
    });

    expect(result).toMatchObject({
      real_name: 'Juan Jose Castillo',
      phone: '+18049701204',
      vehicle_type: 'sedan 2014',
      down_payment: '1500',
      required_down_payment: 1500,
      down_payment_sufficient: true,
    });
  });

  it('associates each answer with its field and ignores agent questions', () => {
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
    const result = normalizeCollectorInput({ channel: 'messenger', real_name: 'Emma Oertly', chat_history_log: transcript });

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
    expect(normalizeCollectorInput({ message: '900 tengo10' }).down_payment).toBe('');
    expect(normalizeCollectorInput({ message: '900 tengo' }).down_payment).toBe('');
  });

  it('reads keyed facts from contaminated workflow memory without preserving the boundary digits', () => {
    const result = normalizeCollectorInput({
      message: '900 tengo10',
      qualification_memory: '2down payment: 10 + trade-in0; vehicle: SUV',
    });
    expect(result.down_payment).toBe('');
    expect(result.vehicle_type).toBe('SUV');
    expect(result.qualification_memory).not.toContain('trade-in0');
  });

  it.each([
    'Quiero mi Auto con Eastern STERLING!',
    'Quiero mi Auto con Eastern BALTIMORE!',
    'Quiero mi Auto con Eastern LAUREL!',
  ])('does not infer trade-in from an Easterns advertising CTA in history: %s', (buttonReply) => {
    const transcript = [buttonReply, 'Tienes un 2014 Toyota Tacoma 4x4?', '3016460540'].join('\n');
    const result = normalizeCollectorInput({
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
    const result = normalizeCollectorInput({ qualification_memory, real_name: 'QA Customer', phone: '+13015550123' });
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
    expect(result.missing_qualification).toEqual(['phone']);
    expect(result.next_question).toBe("What's the best phone number to reach you?");
  });

  it('uses qualification memory as the canonical document value when a custom field is stale', () => {
    const result = normalizeCollectorInput({
      documents: 'not specified',
      qualification_memory: 'vehicle: SUV; down payment: 2K; documents: driver license and proof of income; timeline: today; bank account: yes',
      real_name: 'QA Customer',
      phone: '+13015550123',
    });
    expect(result.documents).toContain('driver license and proof of income');
    expect(result.qualification_complete).toBe(true);
    expect(result.qualification_source).toBe('both');
  });

  it('requires every qualification fact before the downstream trigger can treat a lead as ready', () => {
    expect(isQualificationComplete({
      real_name: 'QA Customer',
      phone: '+13015550123',
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'today',
      has_identification: 'yes',
      has_income_proof: 'yes',
      bank_account: 'yes',
    })).toBe(true);
    expect(isQualificationComplete({
      real_name: 'QA Customer',
      phone: '+13015550123',
      vehicle_type: 'SUV',
      down_payment: '2000',
      purchase_timeline: 'today',
      has_identification: 'yes',
      has_income_proof: '',
    })).toBe(true);
  });

  it('requires only a phone and real vehicle before a lead enters dealerADMIN', () => {
    expect(hasMinimumRoutingQualification({ real_name: 'QA Customer', phone: '+15551234567', vehicle_type: 'SUV' })).toBe(true);
    expect(hasMinimumRoutingQualification({ real_name: '', phone: '+15551234567', vehicle_type: 'SUV' })).toBe(true);
    expect(hasMinimumRoutingQualification({ real_name: 'QA Customer', phone: '+15551234567', vehicle_type: '' })).toBe(false);
    expect(hasMinimumRoutingQualification({ real_name: 'QA Customer', phone: '+15551234567', vehicle_type: ADVISOR_HANDOFF_VEHICLE })).toBe(false);
    expect(hasMinimumRoutingQualification({ real_name: 'QA Customer', phone: '', vehicle_type: 'SUV' })).toBe(false);
  });

  it.each([
    ['stafford', 'whatsapp', '+15715558001'],
    ['fredericksburg', 'messenger', '+15405558002'],
  ])('completes the common routing rule for %s with phone and vehicle only', (source, channel, phone) => {
    const result = normalizeCollectorInput({
      source,
      channel,
      phone,
      message: source === 'stafford' ? 'Honda Civic' : 'Toyota Tacoma',
    });

    expect(result).toMatchObject({
      vehicle_type: source === 'stafford' ? 'Honda Civic' : 'Toyota Tacoma',
      phone,
      qualification_step: 'complete',
      qualification_complete: true,
      missing_qualification: [],
    });
  });

  it('does not treat campaign or intent text as a purchase timeline', () => {
    expect(normalizeCollectorInput({ purchase_timeline: 'Quiero Financiar!' }).purchase_timeline).toBe('');
    expect(normalizeCollectorInput({ qualification_memory: 'timeline: Dónde están ubicados102020' }).purchase_timeline).toBe('');
    expect(normalizeCollectorInput({ message: 'Hoy mismo' }).purchase_timeline).toBe('hoy');
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

  it('keeps the Messenger profile name when the first reply is generic vehicle intent', () => {
    expect(normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Juiccy Zayy',
      message: 'Need a vehicle fast',
      chat_history_log: 'Need a vehicle fast\nSUV\nBaltimore',
    }).real_name).toBe('Juiccy Zayy');
    expect(normalizeCollectorInput({ message: 'Need a vehicle fast' }).real_name).toBe('');
  });

  it.each([
    ['I am Ana Torres', 'Ana Torres'],
    ["I'm Juan Pérez", 'Juan Pérez'],
    ['My name\'s María López', 'María López'],
    ['Llámame Carlos', 'Carlos'],
  ])('recognizes declared names in Spanish and English: %s', (message, expected) => {
    expect(normalizeCollectorInput({ channel: 'whatsapp', message }).real_name).toBe(expected);
  });

  it('rejects a qualification prompt fragment as the real name', () => {
    expect(normalizeCollectorInput({
      channel: 'messenger',
      real_name: 'Cuál Sería El',
      message: 'SUV',
    }).real_name).toBe('');
  });

  it('recognizes prior financing after a below-standard down payment answer', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Leandro Bolzan',
      phone: '+17257103809',
      message: 'Sí',
      chat_history_log: 'SUV\n7257103809\n1000',
      previous_predicted_bot_question: 'Para validar los $1000, ¿anteriormente ya has financiado algún vehículo?',
      down_payment: '1000',
    });

    expect(result).toMatchObject({
      real_name: 'Leandro Bolzan',
      vehicle_type: 'SUV',
      down_payment: '',
      previous_financing: 'yes',
      down_payment_sufficient: false,
      required_down_payment: 2000,
      down_payment_amount: null,
    });
  });

  it('does not recover an Offlease promotion from inbound-only history', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Leandro Bolzan',
      phone: '+17257103809',
      message: 'Sim',
      chat_history_log: 'Ola\nSUV\n7257103809\n1000/2000\nSim',
      previous_predicted_bot_question: 'Para este vehículo requerimos un enganche mínimo de $2000.',
    });

    expect(result).toMatchObject({
      real_name: 'Leandro Bolzan',
      vehicle_type: 'SUV',
      down_payment: '2000',
      previous_financing: '',
      down_payment_sufficient: true,
      required_down_payment: 2000,
    });
  });

  it('extracts the requested vehicle from Portuguese audio text after a greeting comma', () => {
    const result = normalizeCollectorInput({
      source: 'fredericksburg-2',
      channel: 'messenger',
      real_name: 'Leandro Bolzan',
      phone: '+17257103809',
      message: 'Olá, Buenos dias! Eu estive em Pittsburgh. Eu estou procurando um caro SUV. Quanto seria de down payment?',
      chat_history_log: 'Olá, Buenos dias! Eu estive em Pittsburgh. Eu estou procurando um caro SUV. Quanto seria de down payment?',
    });

    expect(result.vehicle_type).toBe('SUV');
  });

  it('captures a one-word name explicitly sent in a WhatsApp conversation without promoting qualification replies', () => {
    const transcript = '*Headline:* Financiamiento inmediato\nYahir\nQuiero ver si puedo con 1000\nLo más pronto posible\nQue y qué papeles ocupo para aplicar\nSedan\nSi sin problema\nSi está bien no hay problema\nHoy si gusta\nA las 5 si se puede por favor';
    const result = normalizeCollectorInput({
      channel: 'whatsapp',
      message: 'A las 5 si se puede por favor',
      chat_history_log: transcript,
      phone: '+18048446382',
    });
    expect(result.real_name).toBe('Yahir');
    expect(normalizeCollectorInput({ channel: 'whatsapp', message: 'Sedan' }).real_name).toBe('');
    expect(normalizeCollectorInput({ channel: 'whatsapp', message: 'Lo más pronto posible' }).real_name).toBe('');
    expect(normalizeCollectorInput({ channel: 'whatsapp', message: 'me llamo yahir' }).real_name).toBe('Yahir');
    expect(normalizeCollectorInput({ channel: 'whatsapp', message: 'Mi nombre es Yahir Pérez' }).real_name).toBe('Yahir Pérez');
    expect(normalizeCollectorInput({ channel: 'whatsapp', message: 'Quiero ver si puedo con 1000' }).down_payment).toBe('1000');
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
    expect(result.qualification_memory).toBe('vehicle: Quiere hablar con un asesor');
  });

  it('keeps Messenger identity in profile metadata instead of the intent message', () => {
    const result = normalizeCollectorInput({
      channel: 'messenger',
      contact_name: 'Juan Perez',
      message: 'Can I See Inventory',
      chat_history_log: 'Can I See Inventory',
    });

    expect(result.real_name).toBe('Juan Perez');
    expect(result.real_name).not.toContain('Inventory');
  });

  it('uses the WhatsApp profile name when the inbound body is only a greeting', () => {
    expect(normalizeCollectorInput({
      channel: 'whatsapp',
      profile: { name: 'Juan Perez' },
      message: 'Buenos Días Bendiciones',
    }).real_name).toBe('Juan Perez');
  });

  it.each([
    ['EliasJosue 🕊Mnegra', false],
    ['J0hn Doe', false],
    ['Juan_123', false],
    ['A B', false],
    ['Precio de Hailader', true],
    ['Juan-Perez', true],
    ["Maria O'Neal", true],
  ] as const)('validates strict real-name characters: %s', (value, expected) => {
    expect(isValidRealName(value)).toBe(expected);
    expect(normalizeRealName(value)).toBe(expected ? normalizeRealName(value) : '');
  });

  it('rejects the production vehicle-price label even though its characters are alphabetic', () => {
    expect(normalizeRealName('Precio de Hailader')).toBe('');
  });

  it('keeps Messenger real_name priority and falls back from invalid WhatsApp real_name to history', () => {
    expect(normalizeCollectorInput({
      source: 'messenger',
      real_name: 'Maria Lopez',
      message: 'SUV',
    }).real_name).toBe('Maria Lopez');

    expect(normalizeCollectorInput({
      source: 'whatsapp',
      real_name: 'EliasJosue 🕊Mnegra',
      message: 'A las 5 si se puede',
      chat_history_log: 'Me llamo Carlos Mendoza\nSUV',
    }).real_name).toBe('Carlos Mendoza');
  });

  it('replays the Stafford WhatsApp transcript and ignores the vehicle-price label as a name', () => {
    const transcript = [
      '*Headline:* Off Lease Motors Of Stafford *Source URL:* https://fb.me/46LvP8ksN ¡Hola! Quiero más información',
      'Hailander 2014',
      'Precio de hailader',
      'Andres',
      'Yo no e financiado ante',
      'Ha civic 2014',
      'Para hacer uber',
      '1000',
      'Estoy en virginia',
    ];

    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Precio de Hailader',
      contact_name: "I'm Andres",
      phone: '+17577762572',
      message: transcript.at(-1),
      chat_history_log: transcript.join('\n'),
      qualification_memory: 'real_name: Precio de Hailader; vehicle: Civic; down payment: 1000',
      vehicle_type: 'Civic',
      down_payment: '1000',
    });

    expect(result.real_name).toBe('Andres');
    expect(result.vehicle_type).toBe('Civic 2014');
    expect(normalizeRealName('Precio de Hailader')).toBe('');
  });

  it.each([
    'Can I See Inventory',
    'Buenos Días Bendiciones',
    'Ana María López García Hernández Rivera',
  ])('rejects non-name text from becoming real_name: %s', (message) => {
    expect(normalizeCollectorInput({ channel: 'whatsapp', message }).real_name).toBe('');
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

  it('normalizes comma-separated grouped phone evidence from Koons', () => {
    const result = normalizeCollectorInput({
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

  it('treats Civic 2014/15 as the latest model year and never as a $15 down payment', () => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      contact_name: 'Me Puede Mandar Fotos',
      phone: '+15713169760',
      message: 'Soy Jaime !',
      chat_history_log: 'Tienes hondas civic 2014/15\nSoy Jaime !',
    });

    expect(result).toMatchObject({
      real_name: 'Jaime',
      vehicle_type: 'Civic 2015',
      vehicle_year: 2015,
      down_payment: '',
    });
    expect(result.down_payment_amount).toBeNull();
  });

  it('keeps a valid 1500 down payment when a later callback hour is 10', () => {
    const transcript = [
      'Manuel',
      'Me interesa una rav 4',
      '1500',
      'Está semana',
      'Si tengo cuenta',
      'Pasaporte nomas',
      'Si',
      '10',
      'Una pregunta solo quiero saber en q estado están. Para ver si no estoy muy lejos',
      'Disculpe',
      'Ok perfecto',
      'Xf si nesesito un carro',
    ].join('\n');

    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      phone: '+13237728671',
      message: transcript,
      chat_history_log: transcript,
    });

    expect(result).toMatchObject({
      vehicle_type: 'RAV4',
      down_payment: '1500',
      down_payment_amount: 1500,
    });
  });

  it('rejects Stafford photo-request labels and keeps the name explicitly declared by the buyer', () => {
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      real_name: 'Me Puede Mandar Fotos',
      contact_name: 'Me Puede Mandar Fotos',
      phone: '+14103016969',
      message: 'Ando buscando un Honda civic',
      chat_history_log: 'Hola cómo está mi nombre es Manuel\nAndo buscando un Honda civic',
      qualification_memory: 'real_name: Me Puede Mandar Fotos; vehicle: Honda Civic',
    });

    expect(result.real_name).toBe('Manuel');
    expect(normalizeRealName('Me Puede Mandar Fotos')).toBe('');
  });

  it('rounds 999 and hides a general down payment below 1000 without blocking routing', () => {
    expect(normalizeCollectorInput({
      source: 'action-cars',
      real_name: 'QA Customer',
      phone: '+13015550123',
      vehicle_type: 'Honda Civic',
      message: '999',
    })).toMatchObject({
      down_payment: '1000',
      down_payment_amount: 1000,
      qualification_complete: true,
    });

    expect(normalizeCollectorInput({
      source: 'action-cars',
      real_name: 'QA Customer',
      phone: '+13015550124',
      vehicle_type: 'Honda Civic',
      message: '850',
    })).toMatchObject({
      down_payment: '',
      down_payment_amount: null,
      qualification_complete: true,
    });
  });

  it('hides an Offlease down payment below 1500 while retaining the phone-plus-vehicle route', () => {
    expect(normalizeCollectorInput({
      source: 'fredericksburg',
      real_name: 'QA Customer',
      phone: '+13015550125',
      vehicle_type: 'Honda Civic',
      message: '1200',
    })).toMatchObject({
      down_payment: '',
      down_payment_amount: null,
      qualification_complete: true,
    });

    expect(normalizeCollectorInput({
      source: 'fredericksburg',
      real_name: 'QA Customer',
      phone: '+13015550126',
      vehicle_type: 'Honda Civic',
      message: '1500',
    }).down_payment).toBe('1500');
  });

  it.each([
    ['Honda Civic 2006', 2006],
    ['Honda Civic 2026', 2026],
  ])('recognizes valid vehicle years only in the 2006-2026 range: %s', (message, year) => {
    expect(normalizeCollectorInput({ message })).toMatchObject({ vehicle_year: year, down_payment: '' });
  });

  it.each(['2005', '1200', '2500', '3000'])('classifies an out-of-range four-digit value as down payment: %s', (message) => {
    expect(normalizeCollectorInput({ vehicle_type: 'Honda Civic', message }).down_payment).toBe(message);
  });

  it('unifies a recognized vehicle year with the vehicle type and rejects a concatenated year amount', () => {
    expect(normalizeCollectorInput({
      vehicle_type: 'Civic 2015',
      message: 'Civic 2015',
      down_payment: '20165',
    })).toMatchObject({
      vehicle_type: 'Civic 2015',
      vehicle_year: 2015,
      down_payment: '',
    });
    expect(normalizeCollectorInput({ message: 'Corolla' }).vehicle_type).toBe('Corolla');
  });
});
