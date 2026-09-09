export type CollectorInput = {
  real_name?: string | null;
  message?: string | null;
  phone?: string | null;
  vehicle_type?: string | null;
  down_payment?: string | null;
  purchase_timeline?: string | null;
  documents?: string | null;
  identification?: string | null;
  bank_account?: string | null;
  qualification_memory?: string | null;
  chat_history_log?: string | null;
};

export type CollectorOutput = {
  real_name: string;
  vehicle_type: string;
  down_payment: string;
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
  qualification_memory: string;
  has_identification: string;
  has_income_proof: string;
  next_question: string;
  qualification_complete: boolean;
  missing_qualification: string[];
  qualification_source: 'custom_fields' | 'qualification_memory' | 'both' | 'none';
};

const EMPTY = '';

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? EMPTY;
}

function isEmptyMarker(value: string): boolean {
  return /^(?:--|-|n\/?a|not indicated|not specified|no indicado|no especificado)$/i.test(value.trim());
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.map(clean).find((value) => Boolean(value) && !isEmptyMarker(value)) ?? EMPTY;
}

function memoryText(memory: string): string {
  const normalized = memory.trim();
  if (!normalized) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(normalized);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
        .join('; ');
    }
  } catch {
    // Qualification memory is commonly plain text; keep parsing that format.
  }
  return normalized
    .replace(/[\r\n]+/g, '; ')
    .replace(/(?:^|;)\s*[-*•]\s*/g, '; ')
    .replace(/\s*\|\s*/g, '; ');
}

function memoryValue(memory: string, aliases: string[]): string {
  const normalized = memoryText(memory);
  if (!normalized) return EMPTY;
  const escapedAliases = [...aliases]
    .sort((left, right) => right.length - left.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+'))
    .join('|');
  const match = normalized.match(new RegExp(`(?:^|[^a-z])(?:${escapedAliases})\\s*(?::|=|-|\\bis\\b|\\bare\\b)\\s*([^;]+)`, 'i'));
  return clean(match?.[1]).replace(/(trade[- ]?in)\d+$/i, '$1');
}

const INVALID_REAL_NAMES = new Set(['.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'whatsapp', 'facebook', 'thu chikitha linda']);
const BUSINESS_NAME_MARKERS = /\b(?:auto\s*sales|motors?|dealership|dealer|llc|inc(?:orporated)?|corp(?:oration)?|company|tatuajes?|tattoos?|operaciones?|operations?|transport(?:ation)?|logistics|construction|remodeling|roofing|realty|consulting|services?|servicios?|shop|tienda|salon|barbershop|restaurant)\b/i;
const QUALIFICATION_RESPONSE_MARKERS = /\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|baltimore|maryland|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|yes|yeah|yep|correct|tengo|have it|i have|si|sí|no|no tengo)\b/i;
const PHONE_LIKE_TEXT = /\b(?:mi|my)\s+(?:n[uú]mero|number|phone|tel[eé]fono|telephone|contact)\b/i;

export function normalizeRealName(value: string | null | undefined): string {
  const candidate = clean(value);
  if (!candidate || INVALID_REAL_NAMES.has(candidate.toLowerCase())) return EMPTY;
  if (PHONE_LIKE_TEXT.test(candidate) || candidate.replace(/\D/g, '').length >= 7) return EMPTY;
  if (!/[a-záéíóúüñ]/i.test(candidate) || /^[\W_\d]+$/u.test(candidate)) return EMPTY;
  // Qualification answers can look like names (for example "En este mes").
  // Never promote a timeline, location, vehicle category, or yes/no answer
  // into the contact's real name.
  if (QUALIFICATION_RESPONSE_MARKERS.test(candidate)) return EMPTY;
  if (candidate.length > 100 || candidate.split(/\s+/).length > 8) return EMPTY;
  return candidate;
}

/**
 * GHL/Messenger contacts can use a business profile as their visible name.
 * Keep it as a useful fallback, but do not let it override a person who
 * identifies themselves in the conversation.
 */
export function isLikelyBusinessName(value: string | null | undefined): boolean {
  return BUSINESS_NAME_MARKERS.test(clean(value));
}

function extractRealNameFromText(value: string): string {
  const source = clean(value);
  if (!source) return EMPTY;
  const explicit = source.match(/(?:me llamo|mi nombre es|soy|my name is|this is)\s+([a-záéíóúüñ][a-záéíóúüñ' -]{1,80})/i);
  const named = normalizeRealName(explicit?.[1]?.split(/[.!?,;]/, 1)[0]);
  if (named) return named;

  // After the bot asks for a full name, people commonly answer with only
  // "First Last". Accept that narrow shape, but never turn vehicle/intent
  // messages into a name before the collector persists it to the contact.
  const candidate = source.replace(/[.!?,;:]+$/g, '');
  if (!/^[a-záéíóúüñ][a-záéíóúüñ'-]*(?:\s+[a-záéíóúüñ][a-záéíóúüñ'-]*){1,3}$/i.test(candidate)) return EMPTY;
  if (/\b(?:quiero|busco|necesito|tengo|carro|auto|veh[ií]culo|suv|sedan|truck|troca|camioneta|pickup|van|financiar|finance|down|payment|hoy|today|yes|no)\b/i.test(candidate)) return EMPTY;
  return normalizeRealName(candidate);
}

export function realNameFromQualificationMemory(memory: string | null | undefined): string {
  return normalizeRealName(memoryValue(memory ?? EMPTY, [
    'real_name', 'real name', 'customer_name', 'customer name', 'contact_name', 'contact name',
    'full_name', 'full name', 'name', 'nombre_real', 'nombre real', 'nombre completo', 'nombre',
  ]));
}

function isCampaignButton(value: string): boolean {
  const normalized = clean(value)
    .replace(/([!?])\s*\d{1,3}$/, '$1')
    .replace(/[!?.,]/g, '')
    .toLowerCase();
  return /^(?:quiero mi auto con eastern|quiero (?:un )?auto hoy|i want (?:a )?car today)$/.test(normalized);
}

function normalizeAmount(value: string): string {
  const source = clean(value).toLowerCase();
  if (!source || isEmptyMarker(source)) return EMPTY;
  if (/\btrade[- ]?in\b|\bmy (?:car|vehicle)\b|\bmi (?:carro|auto)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b|\bchange\s+(?:my\s+)?(?:vehicle|car)\b/i.test(source)) {
    const withoutTradeIn = source
      .replace(/\btrade[- ]?in\b|\bmy (?:car|vehicle)\b|\bmi (?:carro|auto)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b|\bchange\s+(?:my\s+)?(?:vehicle|car)\b/gi, '')
      .replace(/\b(?:and|y)\b|\+/gi, ' ')
      .replace(/\b(?:quiero|want|i have|tengo)\b/gi, ' ')
      .trim();
    const base = /\d|\b(?:cash|contado|efectivo)\b/i.test(withoutTradeIn) ? normalizeAmount(withoutTradeIn) : EMPTY;
    return base ? `${base} + trade-in` : 'trade-in';
  }
  const tradeIn = source.match(/^(.+?)\s*\+\s*trade[- ]?in\d*$/i);
  if (tradeIn) {
    const base = normalizeAmount(tradeIn[1]);
    return base ? `${base} + trade-in` : EMPTY;
  }
  // A 10-15 digit value is a phone-shaped value, not a realistic down payment.
  // This guard also covers phone numbers accidentally copied into the GHL
  // down_payment field or into qualification memory.
  const digits = source.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 15) return EMPTY;
  if (/\b(?:cash|contado|efectivo|paid in full|paga(?:r)? de contado)\b/i.test(source)) return 'Cash';

  const compact = source.replace(/\$/g, '').replace(/,/g, '').trim();
  if (!compact || /^[.]+$/.test(compact)) return EMPTY;
  const kMatch = compact.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kMatch) return String(Math.round(Number(kMatch[1]) * 1000));

  const amountMatch = compact.match(/^(\d+(?:\.\d+)?)\s*(?:dollars?|usd)?$/i);
  if (amountMatch) return String(Math.round(Number(amountMatch[1])));

  const words: Record<string, number> = {
    hundred: 100,
    thousand: 1000,
    'one thousand': 1000,
    'dos mil': 2000,
    'tres mil': 3000,
    'cinco mil': 5000,
  };
  for (const [phrase, amount] of Object.entries(words)) {
    if (source.includes(phrase)) return String(amount);
  }
  return clean(value);
}

function normalizeMemoryDownPayment(value: string): string {
  const source = clean(value);
  if (!source) return EMPTY;
  const tradeIn = /\btrade[- ]?in\b|\bmy (?:car|vehicle)\b|\bmi (?:carro|auto)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b|\bchange\s+(?:my\s+)?(?:vehicle|car)\b/i.test(source);
  const amount = source.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k?)\b/i)?.[1];
  const normalized = amount ? normalizeAmount(amount) : normalizeAmount(source);
  if (!normalized) return tradeIn ? 'trade-in' : EMPTY;
  return tradeIn && !/trade[- ]?in/i.test(normalized) ? `${normalized} + trade-in` : normalized;
}

function firstValidAmount(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = normalizeAmount(value ?? EMPTY);
    if (normalized) return normalized;
  }
  return EMPTY;
}

function normalizeVehicle(value: string): string {
  const source = clean(value).replace(/(?:19|20)\d{2}(?:\d{2})*$/i, '').trim();
  if (!source) return EMPTY;
  if (source.includes('—')) return source;
  const lower = source.toLowerCase();
  const category = lower.match(/\b(suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto)\b/i)?.[1];
  const brand = source.match(/\b(toyota|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla)\b/i)?.[1];
  if (category && brand) return `${category.replace('troca', 'truck')} — ${source}`;
  return source;
}

function extractVehicle(message: string): string {
  const source = clean(message);
  if (!source || isCampaignButton(source)) return EMPTY;
  const withoutOtherFacts = source
    .replace(/(?:\+?1[\s().-]*)?(?:\(?[2-9]\d{2}\)?[\s.-]*)\d{3}[\s.-]?\d{4}/g, ' ')
    .replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?\s*[\d,.]+\s*k?/gi, '')
    .replace(/\b(?:today|hoy|asap|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes)\b/gi, '')
    .split(/[;,]/, 1)[0]
    .trim();
  const requested = withoutOtherFacts.match(/(?:looking for|busco|quiero|want|interested in|interesado en)\s+(?:a|an|un|una)?\s*([^.!?]+)/i)?.[1];
  if (requested) return clean(requested);
  const category = withoutOtherFacts.match(/\b(suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto)\b/i)?.[1];
  const categoryOnly = withoutOtherFacts.match(/^\s*(suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto)\b/i)?.[1];
  if (categoryOnly) return categoryOnly;
  const brand = withoutOtherFacts.match(/\b(toyota|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla)\b/i)?.[1];
  return brand || category ? clean(withoutOtherFacts) : EMPTY;
}

function extractDownPayment(message: string): string {
  const source = clean(message);
  if (!source || isCampaignButton(source)) return EMPTY;
  if (/\b(?:cash|contado|efectivo|paid\s+in\s+full|paga(?:r)?\s+de\s+contado)\b/i.test(source)) return 'Cash';
  const amount = source.match(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?\s*([\d,.]+\s*k?)/i)?.[1]
    ?? source.match(/\$?\s*(\d+(?:[,.]\d+)?\s*k?)\s*(?:(?:for|para|as|on|de|del)\s*)?(?:down|enganche|inicial)/i)?.[1];
  return amount ? normalizeAmount(amount) : EMPTY;
}

function extractTradeInDownPayment(message: string): string {
  const source = clean(message);
  if (!source || isCampaignButton(source)) return EMPTY;

  const amountPattern = '(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?)';
  const tradeInPattern = '(?:trade[- ]?in|my car|my vehicle|mi carro|mi auto|carro como enganche|(?:cambiar|cambio)\\s+(?:(?:mi|el|de)\\s+)?(?:veh[ií]culo|carro|auto)|change\\s+(?:my\\s+)?(?:vehicle|car))';
  const beforeTradeIn = source.match(new RegExp(`\\$?\\s*(${amountPattern})\\s*(?:down|payment|enganche|inicial)?\\s*(?:\\+|and|y)\\s*${tradeInPattern}`, 'i'));
  const afterTradeIn = source.match(new RegExp(`${tradeInPattern}[^0-9]{0,24}\\$?\\s*(${amountPattern})`, 'i'));
  const amount = beforeTradeIn?.[1] ?? afterTradeIn?.[1];
  const normalized = amount ? normalizeAmount(amount) : EMPTY;
  return normalized ? `${normalized} + trade-in` : /\btrade[- ]?in\b|\bmy (?:car|vehicle)\b|\bmi (?:carro|auto)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b|\bchange\s+(?:my\s+)?(?:vehicle|car)\b/i.test(source) ? 'trade-in' : EMPTY;
}

function extractStandaloneDownPayment(message: string): string {
  const source = clean(message);
  if (!source || isCampaignButton(source)) return EMPTY;
  const standalone = source.match(/^\$?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:[,.]\d+)?\s*k?)\s*(?:tengo|have|available|disponible|i have|i can put)?\s*\d{0,2}\s*\.?$/i);
  return standalone ? normalizeAmount(standalone[1]) : EMPTY;
}

function extractTimeline(message: string): string {
  const source = clean(message);
  if (!source) return EMPTY;
  const match = source.match(/\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|esta mes|next week|pr[oó]xima? semana|next month|pr[oó]ximo mes|within \d+ days?|en \d+ d[ií]as?|in \d+ (?:days?|weeks?|months?)|en \d+ (?:d[ií]as?|semanas?|mes(?:es)?)|in a month|en un mes|in two weeks|en dos semanas)\b/i)?.[0];
  return match ? normalizeTimeline(match) : /\b(?:solo|sólo|just|only)\b.*\b(?:mirando|viendo|looking|browsing)\b/i.test(source) ? 'exploring options' : EMPTY;
}

function normalizeTimeline(value: string): string {
  const source = clean(value).toLowerCase();
  if (!source) return EMPTY;
  if (/\b(today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda)\b/i.test(source)) return 'today';
  if (/\b(this|esta)\s+(week|semana)\b/i.test(source)) return 'this week';
  if (/\b(this|este|esta)\s+(month|mes)\b/i.test(source)) return 'this month';
  if (/\b(next|proximo|próximo)\s+(week|semana)\b/i.test(source)) return 'next week';
  if (/\b(next|proximo|próximo)\s+(month|mes)\b/i.test(source)) return 'next month';
  if (/\b(30|thirty)\s+days?\b/i.test(source)) return 'within 30 days';
  if (/\b(?:in|en)\s+(?:a|un|one|uno|two|dos|\d+)\s+(?:days?|d[ií]as?|weeks?|semanas?|months?|mes(?:es)?)\b/i.test(source)) return clean(value).toLowerCase();
  if (/\b(solo|sólo|just|only)\b.*\b(mirando|viendo|looking|browsing)\b/i.test(source)) return 'exploring options';
  return EMPTY;
}

function yesNo(value: string): 'yes' | 'no' | '' {
  const source = clean(value).toLowerCase();
  if (!source) return '';
  if (/\b(no|n[oó]|dont|don't|no tengo|i do not|do not have|don't have|not available)\b/i.test(source)) return 'no';
  if (/\b(yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available)\b/i.test(source)) return 'yes';
  return '';
}

function mergeDocuments(current: string, message: string): { value: string; id: string; income: string } {
  const source = `${current} ${message}`.trim();
  const answer = (documentPattern: string): 'yes' | 'no' | '' => {
    const positive = 'yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available';
    const negative = "no|nó|dont|don't|no tengo|i do not|do not have|don't have|not available";
    const context = source.match(new RegExp(`(?:${positive}|${negative})[^.;!?]{0,60}(?:${documentPattern})|(?:${documentPattern})[^.;!?]{0,60}(?:${positive}|${negative})`, 'i'))?.[0] ?? '';
    const explicit = yesNo(context);
    if (explicit) return explicit;
    if (new RegExp(documentPattern, 'i').test(source) && !/\b(?:no|n[oó]|dont|don't|no tengo|do not have|not available)\b/i.test(source)) {
      return 'yes';
    }
    return '';
  };
  const id = answer('id|identification|identificación|license|licencia');
  const income = answer('proof of income|income proof|prueba de ingresos|comprobante de ingresos');
  const parts = [...new Set(clean(current).split(';').map(clean).filter(Boolean))];
  if (id && !/\b(?:id|identification|identificación|license|licencia)\s*:/i.test(current) && !/\b(?:id|identification|identificación|license|licencia)\b/i.test(current)) {
    parts.push(`identification: ${id}`);
  }
  if (income && !/\b(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos)\s*:/i.test(current) && !/\b(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos)\b/i.test(current)) {
    parts.push(`proof of income: ${income}`);
  }
  return { value: [...new Set(parts.filter(Boolean))].join('; '), id, income };
}

function mergeMemory(current: string, values: Record<string, string>): string {
  let segments = memoryText(current)
    .split(';')
    .map((segment) => clean(segment).replace(/^\d+(?=(?:vehicle|vehicle[_ ]?type|down(?:[_ ]?payment)?|documents?|docs|timeline|purchase[_ ]?timeline)\b)/i, ''))
    .filter((segment) => Boolean(segment) && !/^\$?\d[\d,.]*$/.test(segment));
  for (const [key, value] of Object.entries(values)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segmentKey = segments[index].match(/^[-*•\s]*([^:=\-]+)\s*[:=\-]/)?.[1]?.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isAlias = normalizedKey === 'vehicle' && ['vehicle', 'vehicletype', 'vehicleinterest'].includes(segmentKey || '')
        || normalizedKey === 'downpayment' && ['downpayment', 'down', 'enganche'].includes(segmentKey || '')
        || normalizedKey === 'timeline' && ['timeline', 'purchasetimeline', 'buyingtimeline'].includes(segmentKey || '')
        || normalizedKey === 'documents' && ['documents', 'docs', 'documentos'].includes(segmentKey || '')
        || normalizedKey === 'realname' && ['realname', 'name', 'fullname', 'customername', 'contactname', 'nombrereal', 'nombre', 'nombrecompleto'].includes(segmentKey || '')
        || segmentKey === normalizedKey;
      if (isAlias) segments.splice(index, 1);
    }
    if (clean(value)) segments.push(`${key}: ${clean(value).replace(/\s*;\s*/g, ', ')}`);
  }
  return [...new Set(segments)].join('; ');
}

export function isQualificationComplete(input: {
  vehicle_type?: string | null;
  down_payment?: string | null;
  purchase_timeline?: string | null;
  has_identification?: string | null;
  has_income_proof?: string | null;
  bank_account?: string | null;
}): boolean {
  return Boolean(
    clean(input.vehicle_type) &&
    clean(input.down_payment) &&
    clean(input.purchase_timeline) &&
    input.has_identification === 'yes' &&
    input.has_income_proof === 'yes' &&
    input.bank_account === 'yes',
  );
}

/**
 * Minimum data required before a lead may enter dealerADMIN.
 *
 * Qualification fields are optional at intake. They are preserved and
 * normalized when present, but a lead must not be discarded just because the
 * person has only supplied a phone number yet.
 */
export function hasMinimumRoutingQualification(
  input: Pick<CollectorInput, 'phone'>,
): boolean {
  return Boolean(firstNonEmpty(input.phone));
}

export function normalizeCollectorInput(input: CollectorInput): CollectorOutput {
  const message = clean(input.message);
  const history = clean(input.chat_history_log);
  const memory = input.qualification_memory?.trim() ?? EMPTY;
  const hasMemory = Boolean(memory);
  const hasCustomFields = [
    input.vehicle_type,
    input.down_payment,
    input.purchase_timeline,
    input.documents,
    input.identification,
    input.bank_account,
    input.real_name,
  ].some((value) => Boolean(firstNonEmpty(value)));
  const qualificationSource = hasMemory && hasCustomFields
    ? 'both'
    : hasMemory
      ? 'qualification_memory'
      : hasCustomFields
        ? 'custom_fields'
        : 'none';
  const campaignReply = isCampaignButton(message);
  const messageForExtraction = campaignReply ? EMPTY : message;
  const source = [history, message, memory].filter(Boolean).join('; ');
  const suppliedName = normalizeRealName(input.real_name);
  const extractedNames = [
    realNameFromQualificationMemory(memory),
    extractRealNameFromText(message),
    extractRealNameFromText(history),
  ];
  const realName = (isLikelyBusinessName(suppliedName)
    ? [...extractedNames, suppliedName]
    : [suppliedName, ...extractedNames]
  ).map(normalizeRealName).find(Boolean) ?? EMPTY;
  const vehicle = normalizeVehicle(firstNonEmpty(
    extractVehicle(messageForExtraction),
    extractVehicle(history),
    [
      memoryValue(memory, ['vehicle_type', 'vehicle', 'type']),
      [
        memoryValue(memory, ['make', 'brand', 'marca']),
        memoryValue(memory, ['model', 'vehicle_model', 'modelo']),
      ].filter(Boolean).join(' '),
    ].filter(Boolean).join(' — '),
    memoryValue(memory, ['vehicle', 'vehicle_type']),
    input.vehicle_type,
  ));
  const baseDown = firstValidAmount(
    campaignReply ? EMPTY : input.down_payment,
    extractTradeInDownPayment(messageForExtraction),
    extractDownPayment(messageForExtraction),
    extractStandaloneDownPayment(messageForExtraction),
    extractTradeInDownPayment(history),
    extractDownPayment(history),
    normalizeMemoryDownPayment(memoryValue(memory, ['down payment', 'down_payment', 'downpayment'])),
    extractTradeInDownPayment(memoryText(memory)),
    campaignReply ? EMPTY : input.down_payment,
  );
  const conversationalSource = [history, message].filter(Boolean).join('; ');
  const down = baseDown && /trade[- ]?in|my car|my vehicle|mi carro|mi auto|carro como enganche|(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)|change\s+(?:my\s+)?(?:vehicle|car)/i.test(conversationalSource) && !/trade[- ]?in/i.test(baseDown)
    ? `${baseDown} + trade-in`
    : baseDown;
  const timeline = normalizeTimeline(firstNonEmpty(
    extractTimeline(messageForExtraction),
    extractTimeline(history),
    extractTimeline(memoryText(memory)),
    memoryValue(memory, ['timeline', 'purchase timeline', 'purchase_timeline']),
    input.purchase_timeline,
  ));
  const docs = mergeDocuments(firstNonEmpty(memoryValue(memory, ['documents']), input.documents), source);
  const identification = firstNonEmpty(docs.id, memoryValue(memory, ['identification', 'id']), input.identification);
  const bankAccountRaw = firstNonEmpty(
    input.bank_account,
    source.match(/(?:bank account|cuenta bancaria)[^;]*(?:yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available|no|not|sin|dont|don't|no tengo|i do not|do not have|not available)/i)?.[0],
    memoryValue(memory, ['bank account', 'bank_account']),
  );
  const bankAccount = yesNo(bankAccountRaw);
  const mergedMemory = mergeMemory(memory, {
    real_name: realName,
    vehicle,
    'down payment': down,
    documents: docs.value,
    timeline,
  });

  const nextQuestion = !docs.id
    ? 'Do you have a valid ID or driver license?'
    : !docs.income
      ? 'Do you have proof of income?'
      : !bankAccount
        ? 'Do you have a bank account?'
      : EMPTY;
  const qualificationComplete = isQualificationComplete({
    vehicle_type: vehicle,
    down_payment: down,
    purchase_timeline: timeline,
    has_identification: docs.id,
    has_income_proof: docs.income,
    bank_account: bankAccount,
  });
  const missingQualification = [
    !vehicle ? 'vehicle_type' : EMPTY,
    !down ? 'down_payment' : EMPTY,
    !timeline ? 'purchase_timeline' : EMPTY,
    docs.id !== 'yes' ? 'identification' : EMPTY,
    docs.income !== 'yes' ? 'proof_of_income' : EMPTY,
    bankAccount !== 'yes' ? 'bank_account' : EMPTY,
  ].filter(Boolean);

  return {
    real_name: realName,
    vehicle_type: vehicle,
    down_payment: down,
    purchase_timeline: timeline,
    documents: docs.value,
    identification,
    bank_account: bankAccount,
    qualification_memory: mergedMemory,
    has_identification: docs.id,
    has_income_proof: docs.income,
    next_question: nextQuestion,
    qualification_complete: qualificationComplete,
    missing_qualification: missingQualification,
    qualification_source: qualificationSource,
  };
}
