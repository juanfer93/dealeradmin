import { describe, expect, it } from 'vitest';
import { normalizeCollectorInput } from '../../../leads/domain/collector-normalizer';
import { ConversationQualificationFunctions } from '../../application/functions/conversations/conversation-qualification.functions';

describe('Messenger down-payment confirmation E2E', () => {
  it('normalizes the volunteered amount and keeps the lead routable', () => {
    const transcript = [
      'Que tipo de camiones tienen',
      'Que tipo de camiones tienen',
      'Employee action log created',
      '¡Sí, contamos con opciones de Troca y camiones disponibles! ¿Cuál es el mejor número de teléfono para contactarte y enviarte los detalles?',
      '540-522-7779',
      '540-522-7779',
      'De $3,000 sería perfecto',
      'Si tuvieran trocas de dump eso me interesa',
      'Y que sea Chevrolet',
      'Este mes o al mes de diciembre',
    ].join('\n');
    const normalized = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Federico Choc Maaz',
      phone: '+15405227779',
      vehicle_type: 'Chevrolet',
      message: 'Este mes o al mes de diciembre',
      chat_history_log: transcript,
    });
    const route = new ConversationQualificationFunctions().statusForConversation(
      normalized as never,
      { city: null, state: null, zip_code: null, easterns_zone: null },
      { id: 'dealer-action-cars', routing_config: {} } as never,
      'action-cars',
      new Date('2026-11-18T20:00:00.000Z'),
      'capture',
    );

    expect(normalized).toMatchObject({
      real_name: 'Federico Choc Maaz',
      phone: '+15405227779',
      vehicle_type: 'Chevrolet',
      down_payment: '3000',
      down_payment_amount: 3000,
      purchase_timeline: 'este mes',
      qualification_complete: true,
    });
    expect(route.status).toBe('waiting_window');
    expect(route.nextAttemptAt).toBeTruthy();
  });
});
