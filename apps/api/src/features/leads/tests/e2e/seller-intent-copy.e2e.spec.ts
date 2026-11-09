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
});
