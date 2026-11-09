import { describe, expect, it } from 'vitest';
import { normalizeCollectorInput } from '../../../leads/domain/collector-normalizer';
import { extractLearnableInvalidWhatsAppNamePhrases } from '../../application/functions/conversations/whatsapp-invalid-name-memory';

// Structural summary of ten randomly selected production conversations.
// No production message text, phone, contact ID, or profile value is retained.
const productionSample = [
  { sample: 1, status: 'partial', hasBotNamePrompt: false, messageCount: 13 },
  { sample: 2, status: 'partial', hasBotNamePrompt: false, messageCount: 1 },
  { sample: 3, status: 'sent', hasBotNamePrompt: false, messageCount: 15 },
  { sample: 4, status: 'queued', hasBotNamePrompt: true, messageCount: 54 },
  { sample: 5, status: 'partial', hasBotNamePrompt: false, messageCount: 4 },
  { sample: 6, status: 'stale_phone_ignored', hasBotNamePrompt: false, messageCount: 13 },
  { sample: 7, status: 'sent', hasBotNamePrompt: false, messageCount: 15 },
  { sample: 8, status: 'queued', hasBotNamePrompt: true, messageCount: 34 },
  { sample: 9, status: 'sent', hasBotNamePrompt: false, messageCount: 8 },
  { sample: 10, status: 'queued', hasBotNamePrompt: false, messageCount: 4 },
] as const;

describe('ten anonymized production WhatsApp sample shapes', () => {
  it('contains the ten sampled conversations without retaining identifying data', () => {
    expect(productionSample).toHaveLength(10);
    expect(productionSample.filter((item) => item.hasBotNamePrompt)).toHaveLength(2);
    expect(productionSample.every((item) => item.messageCount > 0)).toBe(true);
  });

  it.each(productionSample)('uses the profile only when sample $sample has no name prompt', ({ hasBotNamePrompt }) => {
    const transcript = hasBotNamePrompt
      ? '__NAME_PROMPT__\nBusco un carro\n__NAME_PROMPT__\nMe llamo Ana QA'
      : 'Me llamo Ana QA\nBusco una SUV';
    const invalidRealNames = extractLearnableInvalidWhatsAppNamePhrases(transcript);
    const result = normalizeCollectorInput({
      source: 'stafford',
      channel: 'whatsapp',
      profile: { name: 'wa_sample_profile' },
      message: transcript,
      chat_history_log: transcript,
      invalid_real_names: invalidRealNames,
    });

    if (hasBotNamePrompt) {
      expect(invalidRealNames).toContain('Busco un carro');
      expect(result.real_name).toBe('Ana Qa');
    } else {
      expect(invalidRealNames).toEqual([]);
      expect(result.real_name).toBe('wa_sample_profile');
    }
  });
});
