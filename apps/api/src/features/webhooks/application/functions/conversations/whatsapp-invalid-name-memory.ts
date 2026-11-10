import { extractDeclaredRealNameFromText, isInvalidRealName, normalizeRealName } from '../../../../leads/domain/collector-normalizer';

type Queryable = {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
};

const NAME_PROMPT = /__NAME_PROMPT__|(?:what(?:'s| is)?\s+(?:your|the)\s+name|what\s+should\s+i\s+call|how\s+do\s+you\s+(?:call|go by)|c[oó]mo\s+te\s+llamas|cu[aá]l\s+es\s+tu\s+nombre|dime\s+tu\s+nombre)/i;
const NAME_DECLARATION = /\b(?:me llamo|mi nombre es|soy|yo soy|my name is|my name['’]s|i am|i['’]m|this is|call me)\s+[\p{L}]/iu;
const BANK_ACCOUNT_LABEL = /^(bank account|cuenta bancaria|cuenta de banco)\b/i;
const CLEAR_NON_NAME_RESPONSE = /\b(?:i|i'm|i am|my|we|me|mi|quiero|necesito|busco|buscando|ando|estoy|looking|need|want|interested|interesa|tienes|tienen|can you|could you|please|send|price|precio|down payment|enganche|suv|sedan|truck|troca|pickup|pick-up|van|camioneta|carro|auto|vehicle|car|mañana|manana|today|tomorrow|hoy|exacto|exactamente|hola|hello|hi|yes|no|stop|where|when|how|what|cu[aá]ndo|d[oó]nde|c[oó]mo)\b/i;

function learnableTailAfterDeclaredName(value: string): string {
  const withoutDeclaration = value.replace(/^\s*(?:me llamo|mi nombre es|my name is|my name['’]s|i am|i['’]m|this is|call me)\s+/i, '');
  const intentStart = withoutDeclaration.search(/\b(?:busco|buscando|quiero|necesito|ando|estoy|tengo|looking|interested|need|want|can|could|send|please|i\s+am|i'm)\b/i);
  if (intentStart <= 0) return '';
  const tail = withoutDeclaration.slice(intentStart).trim();
  return CLEAR_NON_NAME_RESPONSE.test(tail) ? tail : '';
}

/**
 * Learn high-confidence non-name replies even when the stored transcript has
 * lost the outbound name prompt. Ordinary valid names, phone numbers, and
 * profile handles are never learned as invalid identities.
 */
export function extractLearnableInvalidWhatsAppNamePhrases(transcript: string, invalidRealNames: readonly string[] = [], confirmedRealName = ''): string[] {
  const confirmedName = normalizeRealName(confirmedRealName, invalidRealNames);
  const declaredName = extractDeclaredRealNameFromText(transcript, invalidRealNames);
  const hasConfirmedTranscriptName = Boolean(confirmedName && declaredName && confirmedName.toLocaleLowerCase() === declaredName.toLocaleLowerCase());
  const lines = String(transcript ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  const found = new Map<string, string>();
  let repliesLeft = 0;
  for (const line of lines) {
    if (NAME_PROMPT.test(line)) {
      repliesLeft = 8;
      continue;
    }
    const promptContext = repliesLeft > 0;
    if (promptContext) repliesLeft -= 1;
    const candidate = line.replace(/[.!?,;:]+$/g, '').trim();
    if (candidate.length < 2 || candidate.length > 180 || /\d|@/.test(candidate)) continue;
    const accountLabel = candidate.match(BANK_ACCOUNT_LABEL)?.[0];
    if (accountLabel) {
      const key = accountLabel.normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase();
      if (!found.has(key)) found.set(key, accountLabel);
      continue;
    }
    if (NAME_DECLARATION.test(candidate)) {
      if (!promptContext) continue;
      const tail = learnableTailAfterDeclaredName(candidate);
      if (tail.length >= 2) {
        const key = tail.normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase();
        if (!found.has(key)) found.set(key, tail);
      }
      continue;
    }
    const clearlyNonName = isInvalidRealName(candidate, invalidRealNames) || CLEAR_NON_NAME_RESPONSE.test(candidate);
    const normalizerRejected = !normalizeRealName(candidate, invalidRealNames);
    if (!clearlyNonName && !normalizerRejected) continue;
    // Without the original prompt, only learn messages that carry a strong
    // non-name signal. When a real name is independently confirmed, keep that
    // name authoritative while recording these rejected answers.
    if (!promptContext && !hasConfirmedTranscriptName && !CLEAR_NON_NAME_RESPONSE.test(candidate)) continue;
    const key = candidate.normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!found.has(key)) found.set(key, candidate);
  }
  return [...found.values()];
}

export async function loadInvalidRealNames(queryable: Queryable, channel: 'whatsapp' | 'all' = 'whatsapp'): Promise<string[]> {
  const rows = await queryable.query(
    `SELECT normalized_value FROM invalid_real_names WHERE channel = 'all' OR channel = $1 ORDER BY normalized_value`,
    [channel],
  ) as Array<{ normalized_value: string }>;
  return rows.map((row) => row.normalized_value).filter(Boolean);
}

export function loadInvalidWhatsAppNames(queryable: Queryable): Promise<string[]> {
  return loadInvalidRealNames(queryable, 'whatsapp');
}

export async function learnInvalidWhatsAppNames(queryable: Queryable, transcript: string, invalidRealNames: readonly string[] = [], confirmedRealName = ''): Promise<string[]> {
  const learned = extractLearnableInvalidWhatsAppNamePhrases(transcript, invalidRealNames, confirmedRealName);
  for (const displayValue of learned) {
    const normalizedValue = displayValue.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    await queryable.query(
      `INSERT INTO invalid_real_names (channel, normalized_value, display_value, reason)
       VALUES ('whatsapp', $1, $2, 'whatsapp_non_name_response')
       ON CONFLICT (channel, normalized_value) DO UPDATE
       SET display_value = EXCLUDED.display_value,
           observation_count = invalid_real_names.observation_count + 1,
           last_seen_at = CURRENT_TIMESTAMP`,
      [normalizedValue, displayValue],
    );
  }
  return learned.map((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase());
}
