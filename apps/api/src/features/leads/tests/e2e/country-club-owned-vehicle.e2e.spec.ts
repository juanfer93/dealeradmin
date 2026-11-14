import { describe, expect, it } from 'vitest';
import { hasMinimumRoutingQualification, normalizeCollectorInput } from '../../domain/collector-normalizer';

describe('Country Club WhatsApp normalization and routing E2E', () => {
  it('does not route a contact whose only vehicle evidence is one they say they own', () => {
    const transcript = [
      '*Headline:* Hasta $700 de ayuda',
      '*Source URL:* https://fb.me/7foX0L0MJ',
      '¿Cuáles son los requisitos para la promoción? tengo un Ford expedición 2008',
      'Opportunity created',
      'Si',
      'Delmi RAMOS',
    ].join('\n');
    const normalized = normalizeCollectorInput({
      source: 'country',
      channel: 'whatsapp',
      contact_name: 'Ivonne',
      profile: { name: 'Ivonne' },
      phone: '+14109004801',
      message: 'Delmi RAMOS',
      chat_history_log: transcript,
    });

    expect(normalized.vehicle_type).toBe('Quiere hablar con un asesor');
    expect(normalized.vehicle_year).toBeNull();
    expect(normalized.qualification_complete).toBe(false);
    expect(normalized.dealeradmin_send_now).toBe(false);
    expect(hasMinimumRoutingQualification(normalized)).toBe(false);
  });

  it('continues routing an explicit purchase request on the same source and channel', () => {
    const normalized = normalizeCollectorInput({
      source: 'country',
      channel: 'whatsapp',
      contact_name: 'Carlos',
      phone: '+15713498941',
      message: 'Estoy buscando un Ford Expedition 2018',
    });

    expect(normalized.vehicle_type).toBe('Ford Expedition 2018');
    expect(normalized.qualification_complete).toBe(true);
    expect(hasMinimumRoutingQualification(normalized)).toBe(true);
  });

  it('replays Guerrero Molina’s Messenger transcript and recognizes the HUV request as an SUV', () => {
    const transcript = [
      'Busco una huv familiar',
      '¡Excelente! Sí contamos con opciones de SUV familiares disponibles. ¿Cuál es el mejor número de teléfono para contactarte y enviarte los detalles?',
      'Busco una huv familiar',
      '5713498941',
      '5713498941',
    ].join('\n');
    const normalized = normalizeCollectorInput({
      source: 'arlington',
      channel: 'messenger',
      contact_name: 'Guerrero Molina',
      profile: { name: 'Guerrero Molina' },
      phone: '+18045550123',
      message: '5713498941',
      chat_history_log: transcript,
    });

    expect(normalized).toMatchObject({
      vehicle_type: 'SUV',
      vehicle_intent: 'buy',
      qualification_complete: true,
    });
    expect(hasMinimumRoutingQualification(normalized)).toBe(true);
  });
});
