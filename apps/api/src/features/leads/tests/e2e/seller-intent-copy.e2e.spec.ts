import { describe, expect, it } from 'vitest';
import { normalizeCollectorInput } from '../../domain/collector-normalizer';
import { buildWhatsAppMessage } from '../../domain/message-builder';

describe('seller intent copy E2E without Docker', () => {
  it('normalizes Carlos Inzunza’s real Arlington conversation into a seller copy', () => {
    const transcript = [
      'I am selling a tacoma 2021 trd sport 4 doors 2 axles',
      'Are you looking to sell your Tacoma to Arlington Motors, or are you looking for another vehicle?',
      'selling',
      'Got it—your 2021 Tacoma. Are you looking to buy another vehicle as well, or just sell it?',
      'just sell it',
    ].join('\n');
    const normalized = normalizeCollectorInput({
      source: 'arlington',
      channel: 'messenger',
      real_name: 'Carlos Inzunza',
      message: 'just sell it',
      chat_history_log: transcript,
    });
    const copy = buildWhatsAppMessage(normalized.real_name, normalized.phone, {
      language: 'es',
      vehicle_type: normalized.vehicle_type,
      vehicle_intent: normalized.vehicle_intent,
      down_payment: normalized.down_payment,
      purchase_timeline: normalized.purchase_timeline,
    });

    expect(normalized).toMatchObject({ vehicle_type: 'Tacoma 2021', vehicle_intent: 'sell' });
    expect(copy).toBe('Carlos Inzunza Quiere vender su vehículo Tacoma 2021.');
  });

  it('stress-tests ambiguous context: bot sell question alone must not relabel a buyer', () => {
    const normalized = normalizeCollectorInput({
      message: [
        'Are you looking to sell your Tacoma, or are you looking for another vehicle?',
        'No, I am looking for an Explorer.',
      ].join('\n'),
      chat_history_log: 'Bot: Are you looking to sell your Tacoma?\nCustomer: No, I am looking for an Explorer.',
    });
    const copy = buildWhatsAppMessage('Lead', '+15550001111', {
      language: 'en',
      vehicle_type: normalized.vehicle_type,
      vehicle_intent: normalized.vehicle_intent,
    });

    expect(normalized.vehicle_intent).toBe('buy');
    expect(copy).not.toMatch(/sell|vender/i);
    expect(copy).not.toMatch(/Wants to sell their vehicle/);
  });

  it('keeps the requested SUV and carries the Camry as trade-in context across WhatsApp messages', () => {
    const transcript = [
      'Me interesa un suv',
      'Mi nombre es yaniel',
      'Tienes algún suv con muy pocas millas que pueda absorber el negativo de otro carro',
      'Yo tengo un Toyota Camry 2025',
      'Ok y no hay alguna posibilidad de no dar down porq la verdad no puedo ahora mismo haser ese gasto en down',
      'Quisiera q me enviara los autos que tiene',
      'Primero quiero ver las opciones y le diría',
    ].join('\n');
    const normalized = normalizeCollectorInput({
      channel: 'whatsapp',
      contact_name: 'Yaniel',
      phone: '+17868262324',
      message: 'Primero quiero ver las opciones y le diría',
      chat_history_log: transcript,
    });
    const copy = buildWhatsAppMessage(normalized.real_name, normalized.phone, {
      language: 'es',
      vehicle_type: normalized.vehicle_type,
      vehicle_intent: normalized.vehicle_intent,
      down_payment: normalized.down_payment,
      purchase_timeline: normalized.purchase_timeline,
    });

    expect(normalized).toMatchObject({
      vehicle_type: 'SUV',
      vehicle_intent: 'buy',
      vehicle_year: null,
      down_payment: 'trade-in',
      purchase_timeline: 'explorando opciones',
    });
    expect(copy).toContain('SUV');
    expect(copy).toContain('Quiere ver opciones');
    expect(copy).not.toMatch(/Toyota Camry|2025/);
    expect(copy).not.toMatch(/Quiere vender|Wants to sell/i);
  });
});
