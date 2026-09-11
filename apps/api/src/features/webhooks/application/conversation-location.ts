export type ConversationLocation = {
  city: string | null;
  state: string | null;
  zip_code: string | null;
  easterns_zone: string | null;
};

const STATE_ALIASES: Record<string, string> = {
  maryland: 'MD', md: 'MD', virginia: 'VA', va: 'VA',
  pennsylvania: 'PA', pa: 'PA', delaware: 'DE',
  'new york': 'NY', ny: 'NY', 'new jersey': 'NJ', nj: 'NJ',
  'washington dc': 'DC', 'district of columbia': 'DC', dc: 'DC',
};

const KNOWN_EASTERNS_ZONES = ['baltimore', 'laurel', 'sterling'] as const;
const STOP_WORDS = new Set(['this', 'next', 'two', 'a', 'the', 'week', 'month', 'days', 'day']);

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalized(value: string): string {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function stateFromText(value: string): string | null {
  const source = normalized(value);
  const match = Object.keys(STATE_ALIASES)
    .sort((left, right) => right.length - left.length)
    .find((alias) => new RegExp(`\\b${alias.replace(' ', '\\s+')}\\b`, 'i').test(source));
  return match ? STATE_ALIASES[match] : null;
}

function cityFromText(value: string): string | null {
  const source = normalized(value);
  const explicit = source.match(/(?:located|live|living|from|estoy|vivo|ubicad[oa]?|location|ubicacion)\s+(?:in|en|at)?\s*([a-z][a-z' -]{2,50}?)(?:,|\s+(?:md|maryland|va|virginia|pa|pennsylvania|de|delaware|ny|new york|nj|new jersey|dc|washington dc)\b|$)/i)?.[1];
  const candidate = clean(explicit || '');
  if (!candidate || candidate.split(' ').some((part) => STOP_WORDS.has(part))) return null;
  return candidate;
}

export function extractConversationLocation(transcript: string): ConversationLocation {
  const source = clean(transcript);
  const lower = normalized(source);
  const easternsZone = KNOWN_EASTERNS_ZONES.find((zone) =>
    new RegExp(`(?:easterns|con|with|dealer|ubicacion|location)?\\s*${zone}\\b`, 'i').test(lower),
  ) ?? null;
  const zipCode = source.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? null;
  const state = stateFromText(source);
  const city = easternsZone || cityFromText(source);
  return { city, state, zip_code: zipCode, easterns_zone: easternsZone };
}

/**
 * Returns short location candidates for replies such as "Odenton" where the
 * customer answers the previous city question without repeating "I live in".
 * The database remains the authority for deciding whether a candidate is a
 * real US location and which state it belongs to.
 */
export function extractLocationCandidates(transcript: string): string[] {
  const words = normalized(transcript).split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  const candidates = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    for (let size = 1; size <= 4 && start + size <= words.length; size += 1) {
      candidates.add(words.slice(start, start + size).join(' '));
    }
  }
  return [...candidates];
}
