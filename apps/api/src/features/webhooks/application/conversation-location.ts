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
const LOCATION_CUE = /\b(?:located|live|living|from|estoy|vivo|ubicad[oa]?|location|ubicaci[oó]n)\b/i;
const VEHICLE_OR_QUALIFICATION_SIGNAL = /\b(?:vehicle|veh[ií]culo|car|carro|auto|truck|troca|pickup|pick-up|suv|sedan|van|minivan|crossover|coupe|coup[eé]|hatchback|motorcycle|moto|camioneta|toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion|mustang|tacoma|trail hunter|rav4|civic|accord|camry|corolla|f-?150|explorer|cr-v|pilot|sierra|silverado|wrangler|wrx|highlander|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|sportage|telluride|palisade|tucson|looking for|busco|buscando|quiero|want|need|necesito|tengo|have|down|enganche|payment|compra|buy|comprar|financ|document|identificaci[oó]n|income|ingresos|proof|prueba|nombre|name|phone|tel[eé]fono|number)\b/i;
const STATE_TOKEN = /\b(?:maryland|md|virginia|va|pennsylvania|pa|delaware|de|new york|ny|new jersey|nj|district of columbia|washington dc|dc)\b/i;

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
  const candidates = new Set<string>();
  const direct = extractConversationLocation(transcript);
  if (direct.city) candidates.add(normalized(direct.city));

  for (const rawLine of String(transcript ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = clean(rawLine);
    if (!line) continue;
    const lowerLine = normalized(line);

    // A location plus an explicit state is strong evidence, even when the
    // same reply also contains qualification text. Prefer the text immediately
    // before the state token so a vehicle model cannot become the city.
    const stateMatch = lowerLine.match(STATE_TOKEN);
    if (stateMatch?.index !== undefined) {
      const beforeState = clean(lowerLine.slice(0, stateMatch.index).replace(/[,;]+$/g, ''));
      const cueMatch = beforeState.match(/(?:located|live|living|from|estoy|vivo|ubicad[oa]?|location|ubicaci[oó]n)\s+(?:in|en|at)?\s*/i);
      // Without a location cue, a vehicle-bearing answer such as
      // "I want a Toyota Tacoma VA" is not geographic evidence. Letting it
      // reach the catalog would resolve the Tacoma model as Tacoma, VA.
      if (!cueMatch && VEHICLE_OR_QUALIFICATION_SIGNAL.test(beforeState)) continue;
      const cityText = clean((cueMatch ? beforeState.slice(cueMatch.index! + cueMatch[0].length) : beforeState)
        .replace(/^(?:what city are you in|what city|city|where do you live)\??\s*/i, '')
        .replace(/^(?:i am|i'm|im)\s+/i, ''));
      addLocationNgrams(cityText, candidates);
      continue;
    }

    // Answers after a bot question such as "What city are you in? Odenton"
    // are location evidence only when the answer itself is short and free of
    // vehicle/qualification signals.
    const answer = line.includes('?') ? clean(line.slice(line.lastIndexOf('?') + 1)) : line;
    if (!answer || answer.includes('?') || VEHICLE_OR_QUALIFICATION_SIGNAL.test(answer)) continue;
    if (LOCATION_CUE.test(line) || answer.split(/\s+/).length <= 4) addLocationNgrams(answer, candidates);
  }
  return [...candidates];
}

function addLocationNgrams(value: string, candidates: Set<string>): void {
  const words = normalized(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      candidates.add(words.slice(start, start + size).join(' '));
    }
  }
}
