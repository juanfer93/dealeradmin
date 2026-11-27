import { describe, expect, it } from 'vitest';
import { hasMinimumRoutingQualification, normalizeCollectorInput } from '../../../leads/domain/collector-normalizer';
import { ConversationQualificationFunctions } from '../../application/functions/conversations/conversation-qualification.functions';

describe('Default advisor routing E2E', () => {
  it('routes a Messenger request for a call without a vehicle to waiting_window', () => {
    const transcript = [
      'Puedo consultar una llamada',
      'Con gusto 👍 ¿Cuál es el mejor número para contactarte?',
      'este minumero 571 436 7467',
    ].join('\n');
    const normalized = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Nicolas Diaz',
      phone: '+15714367467',
      message: 'este minumero 571 436 7467',
      chat_history_log: transcript,
      vehicle_type: 'Quiere hablar con un asesor',
    });
    const status = new ConversationQualificationFunctions().statusForConversation(
      normalized as never,
      { city: null, state: null, zip_code: null, easterns_zone: null },
      { id: 'dealer-action-cars', routing_config: {} } as never,
      'action-cars',
      new Date('2026-11-27T16:08:57.000Z'),
      'capture',
    );

    expect(normalized).toMatchObject({
      vehicle_type: 'Quiere hablar con un asesor',
      advisor_handoff_requested: true,
      qualification_complete: true,
      missing_qualification: [],
    });
    expect(hasMinimumRoutingQualification(normalized)).toBe(true);
    expect(status.status).toBe('waiting_window');
  });

  it('keeps the advisor value when the buyer wants any inexpensive working car and starts waiting_window', () => {
    const transcript = [
      'I need a car asap. I have had my job for a while now and I am in desperate need of a vehicle. I am a single mom looking for a safe reliable cheap vehicle that I can get with possibly no money down.',
      'I dont care what it is as long as it runs',
      'Im looking for the cheapest vehicle possible.',
      'Im in Brooklyn park md.',
      '443-409-7196 ive spoke to people before i have a steady income i dont wanna be bsed again i need to get something asap',
      'Yes',
      'I get paid on Wednesday so I would like to be able to do so around then if possible as far as insurance wise.',
    ].join('\n');
    const normalized = normalizeCollectorInput({
      source: 'action-cars',
      channel: 'messenger',
      real_name: 'Shannon Marrie',
      phone: '+14434097196',
      message: 'I get paid on Wednesday so I would like to be able to do so around then if possible as far as insurance wise.',
      chat_history_log: transcript,
      vehicle_type: 'Quiere hablar con un asesor',
    });

    const status = new ConversationQualificationFunctions().statusForConversation(
      normalized as never,
      { city: null, state: null, zip_code: null, easterns_zone: null },
      { id: 'dealer-action-cars', routing_config: {} } as never,
      'action-cars',
      new Date('2026-11-18T19:00:00.000Z'),
      'capture',
    );

    expect(normalized).toMatchObject({
      vehicle_type: 'Quiere hablar con un asesor',
      vehicle_intent: 'buy',
      advisor_handoff_requested: true,
      qualification_complete: true,
      missing_qualification: [],
    });
    expect(hasMinimumRoutingQualification(normalized)).toBe(true);
    expect(status.status).toBe('waiting_window');
    expect(status.nextAttemptAt).toBeTruthy();
  });
});
