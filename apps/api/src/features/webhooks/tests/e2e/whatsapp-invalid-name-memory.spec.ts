import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { InvalidRealNames1710000055000 } from '../../../../database/migrations/1710000055000-InvalidRealNames';
import { MessengerInvalidRealNames1710000057000 } from '../../../../database/migrations/1710000057000-MessengerInvalidRealNames';
import { normalizeCollectorInput } from '../../../leads/domain/collector-normalizer';
import { learnInvalidMessengerNames, learnInvalidWhatsAppNames, loadInvalidRealNames } from '../../application/functions/conversations/whatsapp-invalid-name-memory';

const databaseUrl = process.env.WHATSAPP_NAME_MEMORY_E2E_DATABASE_URL;

describe.skipIf(!databaseUrl)('WhatsApp invalid-name memory (local PostgreSQL E2E)', () => {
  const dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [], migrations: [], synchronize: false });
  const learnedPhrase = 'busco un carro';
  const learnedTail = 'busco una honda civic';

  it('learns a rejected answer after an outbound name prompt and uses the WhatsApp profile when no name was requested', async () => {
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await new InvalidRealNames1710000055000().up(runner);
      await new MessengerInvalidRealNames1710000057000().up(runner);
      const learned = await learnInvalidWhatsAppNames(
        runner,
        `__NAME_PROMPT__\n${learnedPhrase}\n__NAME_PROMPT__\nMe llamo Ana Torres`,
      );
      expect(learned).toEqual([learnedPhrase]);

      const catalog = await loadInvalidRealNames(runner, 'whatsapp');
      expect(catalog).toContain(learnedPhrase);

      const learnedTailValues = await learnInvalidWhatsAppNames(
        runner,
        '__NAME_PROMPT__\nMe llamo Juan Inzunza y busco una Honda Civic',
        catalog,
      );
      expect(learnedTailValues).toEqual([learnedTail]);
      const catalogWithTail = await loadInvalidRealNames(runner, 'whatsapp');
      expect(catalogWithTail).toContain(learnedTail);

      const afterPrompt = normalizeCollectorInput({
        source: 'stafford',
        channel: 'whatsapp',
        profile: { name: 'WA Profile User' },
        invalid_real_names: catalogWithTail,
        message: `__NAME_PROMPT__\n${learnedPhrase}`,
        chat_history_log: `__NAME_PROMPT__\n${learnedPhrase}`,
      });
      expect(afterPrompt.real_name).toBe('Wa Profile User');

      const mixedName = normalizeCollectorInput({
        source: 'stafford',
        channel: 'whatsapp',
        profile: { name: 'wa_profile_user' },
        invalid_real_names: catalogWithTail,
        message: '__NAME_PROMPT__\nJuan Inzunza busco una Honda Civic',
        chat_history_log: '__NAME_PROMPT__\nJuan Inzunza busco una Honda Civic',
      });
      expect(mixedName.real_name).toBe('Juan Inzunza');

      const withoutPrompt = normalizeCollectorInput({
        source: 'stafford',
        channel: 'whatsapp',
        profile: { name: 'WA Profile User' },
        invalid_real_names: catalog,
        message: 'Ana Torres',
        chat_history_log: 'Ana Torres',
      });
      expect(withoutPrompt.real_name).toBe('Wa Profile User');
    } finally {
      await runner.query('DELETE FROM invalid_real_names WHERE channel = $1 AND normalized_value = $2', [
        'whatsapp', learnedPhrase,
      ]);
      await runner.query('DELETE FROM invalid_real_names WHERE channel = $1 AND normalized_value = $2', [
        'whatsapp', learnedTail,
      ]);
      await runner.release();
      await dataSource.destroy();
    }
  });

  it('learns Messenger invalid replies after name prompts and preserves the native profile by default', async () => {
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    const phrase = 'retired';
    await runner.connect();
    try {
      await new InvalidRealNames1710000055000().up(runner);
      await new MessengerInvalidRealNames1710000057000().up(runner);
      await learnInvalidMessengerNames(runner, '__NAME_PROMPT__\n__INBOUND__ I am retired', [], 'DeJuan Hodgins Sr.');
      const catalog = await loadInvalidRealNames(runner, 'messenger');
      expect(catalog).toContain(phrase);

      const result = normalizeCollectorInput({
        channel: 'messenger',
        contact_name: 'DeJuan Hodgins Sr.',
        invalid_real_names: catalog,
        message: 'I am retired',
        chat_history_log: 'What vehicle are you looking for?\nI am retired',
      });
      expect(result.real_name).toBe('DeJuan Hodgins Sr.');

      const attempts = await Promise.all(Array.from({ length: 50 }, async () => {
        const concurrentRunner = dataSource.createQueryRunner();
        await concurrentRunner.connect();
        try {
          return await learnInvalidMessengerNames(concurrentRunner, '__NAME_PROMPT__\n__INBOUND__ I am retired', catalog, 'DeJuan Hodgins Sr.');
        } finally {
          await concurrentRunner.release();
        }
      }));
      expect(attempts.every((resultSet) => resultSet[0] === phrase)).toBe(true);
      const observation = await runner.query('SELECT observation_count FROM invalid_real_names WHERE channel = $1 AND normalized_value = $2', ['messenger', phrase]) as Array<{ observation_count: number }>;
      expect(Number(observation[0]?.observation_count)).toBeGreaterThanOrEqual(51);

      await learnInvalidWhatsAppNames(runner, '__NAME_PROMPT__\nI am retired');
      const whatsappCatalog = await loadInvalidRealNames(runner, 'whatsapp');
      expect(whatsappCatalog).not.toContain(phrase);
      expect(catalog).toContain(phrase);
    } finally {
      await runner.query('DELETE FROM invalid_real_names WHERE channel = $1 AND normalized_value = $2', ['messenger', phrase]);
      await runner.query('DELETE FROM invalid_real_names WHERE channel = $1 AND normalized_value = $2', ['whatsapp', phrase]);
      await runner.release();
      await dataSource.destroy();
    }
  });
});
