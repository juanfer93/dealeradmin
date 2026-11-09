import { describe, expect, it, vi } from 'vitest';
import { extractLearnableInvalidWhatsAppNamePhrases, learnInvalidWhatsAppNames, loadInvalidWhatsAppNames } from '../../application/functions/conversations/whatsapp-invalid-name-memory';

describe('WhatsApp invalid real-name memory', () => {
  it('learns only strong non-name replies near an outbound name prompt', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases([
      '__NAME_PROMPT__',
      'Ahorita estoy trabajando',
      'Me llamo Carlos Perez y busco una camioneta',
      'Juan Perez',
      'Buscando Honda Civic',
    ].join('\n'))).toEqual(['Ahorita estoy trabajando', 'busco una camioneta', 'Buscando Honda Civic']);
  });

  it('does not learn conversational text without a preceding name prompt', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases('Buscando Honda Civic\nAhorita estoy trabajando')).toEqual([]);
  });

  it('records a catalogued phrase when the prompt-bounded normalizer discards it', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases('__NAME_PROMPT__\nExacto', ['exacto'])).toEqual(['Exacto']);
  });

  it('never learns name declarations, phone-like messages, or profile values', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases([
      '__NAME_PROMPT__',
      'Mi nombre es Carlos Perez, ando buscando una Tacoma',
      '7579434663',
      '@carlos',
      'Lucia Fernandez',
    ].join('\n'))).toEqual(['ando buscando una Tacoma']);
  });

  it('learns only the extra qualification phrase after keeping a declared name', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases(
      '__NAME_PROMPT__\nMe llamo Juan Inzunza y busco una Honda Civic',
    )).toEqual(['busco una Honda Civic']);
  });

  it('persists normalized phrases and refreshes observation counts idempotently', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const learned = await learnInvalidWhatsAppNames({ query }, '__NAME_PROMPT__\n  Buscando   Honda Civic.');

    expect(learned).toEqual(['buscando honda civic']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO invalid_real_names'), ['buscando honda civic', 'Buscando   Honda Civic']);
    expect(String(query.mock.calls[0][0])).toContain('ON CONFLICT (channel, normalized_value) DO UPDATE');
  });

  it('loads only the WhatsApp invalid-name catalog', async () => {
    const query = vi.fn().mockResolvedValue([{ normalized_value: 'buscando honda civic' }]);
    await expect(loadInvalidWhatsAppNames({ query })).resolves.toEqual(['buscando honda civic']);
    expect(String(query.mock.calls[0][0])).toContain("WHERE channel = 'all' OR channel = $1");
    expect(query.mock.calls[0][1]).toEqual(['whatsapp']);
  });
});
