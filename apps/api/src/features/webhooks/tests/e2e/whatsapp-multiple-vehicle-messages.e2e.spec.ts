import { describe, expect, it } from 'vitest';
import { normalizeCollectorInput } from '../../../leads/domain/collector-normalizer';
import { ConversationQualificationFunctions } from '../../application/functions/conversations/conversation-qualification.functions';

describe('WhatsApp multiple-vehicle messages E2E', () => {
  it('keeps Toyota Highlander and Honda CR-V sent in separate buyer messages', () => {
    const inbound = ['BUSCO UNA SUV', 'Toyota highlander', 'O honda crv', '2500$'].join('\n');
    const normalized = normalizeCollectorInput({
      source: 'lucki',
      channel: 'whatsapp',
      real_name: 'Raider Yoel',
      profile: { name: 'Raider Yoel' },
      phone: '+18048339050',
      down_payment: '2500',
      message: '2500$',
      chat_history_log: [
        'Outbound: We have several vehicles. Are you looking for a Ford Escape?',
        inbound,
      ].join('\n'),
      vehicle_transcript: inbound,
    });
    const status = new ConversationQualificationFunctions().statusForConversation(
      normalized as never,
      { city: null, state: null, zip_code: null, easterns_zone: null },
      { id: 'dealer-lucki', routing_config: {} } as never,
      'lucki',
      new Date('2026-11-18T21:20:00.000Z'),
      'capture',
    );

    expect(normalized).toMatchObject({
      real_name: 'Raider Yoel',
      vehicle_type: 'Toyota Highlander o Honda CR-V',
      down_payment: '2500',
      phone: '+18048339050',
    });
    expect(status.status).toBe('waiting_window');
  });
});
