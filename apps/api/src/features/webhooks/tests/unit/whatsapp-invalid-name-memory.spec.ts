import { describe, expect, it, vi } from 'vitest';
import { extractLearnableInvalidWhatsAppNamePhrases, learnInvalidWhatsAppNames, loadInvalidWhatsAppNames } from '../../application/functions/conversations/whatsapp-invalid-name-memory';

describe('WhatsApp invalid real-name memory', () => {
  it('learns only strong non-name replies near an outbound name prompt', () => {
    const transcript = [
      '__NAME_PROMPT__',
      'Ahorita estoy trabajando',
      'Me llamo Carlos Perez y busco una camioneta',
      'Juan Perez',
      'Buscando Honda Civic',
    ].join('\n');
    expect(extractLearnableInvalidWhatsAppNamePhrases(transcript, [], 'Carlos Perez')).toEqual(['Ahorita estoy trabajando', 'busco una camioneta', 'Buscando Honda Civic']);
  });

  it('learns strong non-name replies when the stored transcript has no name prompt', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases('Buscando Honda Civic\nAhorita estoy trabajando')).toEqual([
      'Buscando Honda Civic',
      'Ahorita estoy trabajando',
    ]);
  });

  it('records a catalogued phrase when the prompt-bounded normalizer discards it', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases('__NAME_PROMPT__\nExacto\n__NAME_PROMPT__\nMe llamo Ana QA', ['exacto'], 'Ana QA')).toEqual(['Exacto']);
  });

  it('never learns name declarations, phone-like messages, or profile values', () => {
    const transcript = [
      '__NAME_PROMPT__',
      'Mi nombre es Carlos Perez, ando buscando una Tacoma',
      '7579434663',
      '@carlos',
      'Lucia Fernandez',
    ].join('\n');
    expect(extractLearnableInvalidWhatsAppNamePhrases(transcript, [], 'Carlos Perez')).toEqual(['ando buscando una Tacoma']);
  });

  it('learns only the extra qualification phrase after keeping a declared name', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases(
      '__NAME_PROMPT__\nMe llamo Juan Inzunza y busco una Honda Civic',
      [],
      'Juan Inzunza',
    )).toEqual(['busco una Honda Civic']);
  });

  it('learns only the account label after a confirmed name is found later', () => {
    const transcript = [
      '__NAME_PROMPT__',
      'Cuenta de banco y quiero sacar un carro financiado pero vivo en Carolina del Norte',
      '__NAME_PROMPT__',
      'Me llamo José Velázquez',
    ].join('\n');

    expect(extractLearnableInvalidWhatsAppNamePhrases(transcript, [], 'José Velázquez')).toEqual(['Cuenta de banco']);
    // A bad answer remains learnable even if an erroneous provisional name was
    // passed in; reconciliation separately gives the explicit transcript name
    // higher precedence when writing the real-name field.
    expect(extractLearnableInvalidWhatsAppNamePhrases(transcript, [], 'Cuenta de banco')).toEqual(['Cuenta de banco']);
  });

  it('learns an account answer even when no name prompt or confirmed name was stored', () => {
    expect(extractLearnableInvalidWhatsAppNamePhrases(
      'Cuenta de banco y quiero sacar un carro financiado pero vivo en Carolina del Norte',
    )).toEqual(['Cuenta de banco']);
  });

  it('persists normalized phrases and refreshes observation counts idempotently', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const transcript = '__NAME_PROMPT__\n  Buscando   Honda Civic.\n__NAME_PROMPT__\nMe llamo Ana QA';
    const learned = await learnInvalidWhatsAppNames({ query }, transcript, [], 'Ana QA');

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
