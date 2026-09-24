import { CASH_DOWN_PAYMENT, evaluateDownPayment, type VehicleCategory } from './down-payment';

export type CollectorInput = {
  source?: string | null;
  channel?: string | null;
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
  customer_location?: string | null;
  previous_predicted_bot_question?: string | null;
};

export type CollectorOutput = {
  real_name: string;
  vehicle_type: string;
  customer_location: string;
  vehicle_category: VehicleCategory | null;
  required_down_payment: number | null;
  down_payment_amount: number | null;
  down_payment_sufficient: boolean;
  down_payment: string;
  previous_financing: 'yes' | 'no' | '';
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
  qualification_memory: string;
  has_identification: string;
  has_income_proof: string;
  next_question: string;
  qualification_step: QualificationStep;
  qualification_progress: QualificationProgress;
  qualification_complete: boolean;
  missing_qualification: string[];
  qualification_source: 'custom_fields' | 'qualification_memory' | 'both' | 'none';
  phone: string;
  chat_history_log: string;
  dealeradmin_send_now: boolean;
};

export type CollectorLanguage = 'es' | 'en';
export type QualificationStep = 'real_name' | 'vehicle_type' | 'customer_location' | 'phone' | 'down_payment' | 'purchase_timeline' | 'documents' | 'bank_account' | 'complete';
export type QualificationProgress = {
  step: QualificationStep;
  last_answered_field: string | null;
  predicted_bot_question: string;
  language: CollectorLanguage;
  confidence: number;
  evidence: 'transcript' | 'normalized_fields' | 'complete';
};

const EMPTY = '';
export const ADVISOR_HANDOFF_VEHICLE = 'Quiere hablar con un asesor';

export function isAdvisorHandoffVehicle(value: string | null | undefined): boolean {
  return clean(value).toLocaleLowerCase() === ADVISOR_HANDOFF_VEHICLE.toLocaleLowerCase();
}

const ENGLISH_LANGUAGE_SIGNALS = [
  /\b(?:i|i'm|im|my|want|wants|need|looking|have|this|next|today|where|what|can|with|and|the|yes|yeah|yep|do|does|when|how)\b/gi,
  /\b(?:proof of income|bank account|driver(?:'s)? license|this month|next month|more information|requirements?)\b/gi,
];
const SPANISH_LANGUAGE_SIGNALS = [
  /\b(?:yo|mi|quiero|quiere|necesito|busco|tengo|este|esta|hoy|donde|qué|que|con|y|el|la|los|las)\b/gi,
  /\b(?:prueba de ingresos|cuenta bancaria|licencia de conducir|este mes|pr[oó]ximo mes|más información|requisitos?)\b/gi,
];

function languageScore(source: string, signals: RegExp[]): number {
  return signals.reduce((score, signal) => score + (source.match(signal)?.length ?? 0), 0);
}

/** Detect the language of a conversation without treating a vehicle label as language evidence. */
export function detectLeadLanguage(value: string | null | undefined): CollectorLanguage {
  const source = clean(value).toLocaleLowerCase();
  if (!source) return 'es';
  const englishScore = languageScore(source, ENGLISH_LANGUAGE_SIGNALS);
  const spanishScore = languageScore(source, SPANISH_LANGUAGE_SIGNALS);
  return englishScore > spanishScore ? 'en' : 'es';
}

const PHONE_PATTERN = /(?<!\d)(?:\+?1[\s().-]*)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g;

function extractPhone(value: string | null | undefined): string {
  const source = clean(value);
  const direct = /^\+?[\d\s().-]+$/.test(source)
    && (source.replace(/\D/g, '').length === 10 || (source.replace(/\D/g, '').length === 11 && source.replace(/\D/g, '').startsWith('1')))
    ? source
    : EMPTY;
  const match = direct || source.match(PHONE_PATTERN)?.[0] || EMPTY;
  if (!match) return EMPTY;
  const digits = match.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  return digits.length === 11 && digits.startsWith('1') ? `+${digits}` : EMPTY;
}

export const RECENT_PHONE_EVIDENCE_DAYS = 3;

/**
 * A contact phone supplied by GHL is only metadata. A lead may use a phone
 * for routing when that same number is present in an inbound message from the
 * recent conversation window; old transcript evidence must not resurrect it.
 */
export function extractRecentMessagePhone(
  messages: Array<{ body?: string | null; direction?: string | null; occurred_at?: string | Date | null }>,
  referenceAt: Date,
  maxAgeDays = RECENT_PHONE_EVIDENCE_DAYS,
): string {
  const cutoff = referenceAt.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return messages
    .map((message) => ({
      body: String(message.body ?? ''),
      direction: String(message.direction ?? '').toLowerCase(),
      occurredAt: message.occurred_at ? new Date(message.occurred_at).getTime() : Number.NaN,
    }))
    .filter((message) => message.direction === 'inbound' && Number.isFinite(message.occurredAt) && message.occurredAt >= cutoff && message.occurredAt <= referenceAt.getTime())
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .map((message) => extractPhone(message.body))
    .find(Boolean) ?? EMPTY;
}

function isPhoneOnlyLine(value: string): boolean {
  const source = clean(value);
  const digits = source.replace(/\D/g, '');
  return (digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))
    && !/[a-záéíóúüñ]/i.test(source);
}

function isPhoneAreaCodeAmount(value: string, phone: string): boolean {
  const areaCode = phone.match(/^\+1(\d{3})/)?.[1] ?? EMPTY;
  return Boolean(areaCode && clean(value).replace(/\D/g, '') === areaCode);
}

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? EMPTY;
}

function conversationalEvidence(...values: Array<string | null | undefined>): string {
  return values
    .flatMap((value) => String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes('?') && !/^\s*(?:do you|does|did|what|which|when|where|how|can you|are you|tienes|tiene|cu[aá]l|qu[eé]|cu[aá]ndo|d[oó]nde|c[oó]mo)\b/i.test(line))
    .join('; ');
}

function isEmptyMarker(value: string): boolean {
  return /^(?:--|-|n\/?a|not indicated|not specified|no indicado|no especificado)$/i.test(value.trim());
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.map(clean).find((value) => Boolean(value) && !isEmptyMarker(value)) ?? EMPTY;
}

function isMessengerChannel(value: string | null | undefined): boolean {
  return /(?:^|[^a-z])(?:messenger|facebook)(?:$|[^a-z])/i.test(clean(value));
}

function isWhatsAppChannel(value: string | null | undefined): boolean {
  return /(?:^|[^a-z])whats?app(?:$|[^a-z])/i.test(clean(value));
}

type CollectorFlowPolicy = {
  sourceAware: boolean;
  offlease: boolean;
  stafford: boolean;
  requiresLocation: boolean;
  phoneSatisfiedByNative: boolean;
  requiresRealName: boolean;
};

function collectorFlowPolicy(input: CollectorInput): CollectorFlowPolicy {
  const source = clean(input.source).toLocaleLowerCase();
  const sourceAware = Boolean(source);
  const stafford = source === 'stafford';
  const offlease = source === 'stafford' || source === 'fredericksburg' || source === 'fredericksburg-2';
  const requiresLocation = source === 'easterns' || source === 'easterns-millersville';
  return {
    sourceAware,
    offlease,
    stafford,
    requiresLocation,
    phoneSatisfiedByNative: stafford && isWhatsAppChannel(input.channel),
    // Every dealer queue row must carry a usable customer name. Messenger
    // supplies it from the GHL contact display name; WhatsApp must declare it.
    requiresRealName: true,
  };
}

function extractCustomerLocation(input: CollectorInput, transcript: string): string {
  const supplied = firstNonEmpty(input.customer_location);
  if (supplied) return supplied;
  const match = transcript.match(/\b(Baltimore|Laurel|Sterling|Millersville|Frederick|Fredericksburg|Woodbridge|Alexandria|Culpeper|Stafford)\b/i)?.[1];
  return match ? `${match[0].toLocaleUpperCase()}${match.slice(1).toLocaleLowerCase()}` : EMPTY;
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

const PREVIOUS_FINANCING_QUESTION = /\b(?:has\s+financiado|han?\s+financiado|have\s+you\s+financed|did\s+you\s+finance|financ(?:ed|ing)\s+before|financiamiento\s+(?:de autos?|de un veh[ií]culo)|(?:ya|antes|anteriormente|previously|before)[^?\n]{0,80}(?:financ(?:e|ed|ing)|financiad[oa]))\b/i;
const PREVIOUS_FINANCING_YES = /(?:ya\s+he\s+financiad[oa]|he\s+financiad[oa]\s+antes|financi[eé]\s+antes|(?:ya|anteriormente)\s+financi[eé](?=\s|$|[,.;!?])|i\s+have\s+financed\s+before|i\s+financed\s+(?:a|an|the)\s+(?:vehicle|car)|financed\s+before|previous(?:ly)?\s+financ(?:ed|ing))/i;
const PREVIOUS_FINANCING_NO = /^(?:no(?=[\s,.;!?]|$)|nope|nah|nunca|jam[aá]s|never|not\s+before|no\s+(?:he\s+)?financiad[oa]|no\s+tengo\s+(?:historial|experiencia|financiamiento))/i;
const PREVIOUS_FINANCING_AFFIRMATIVE = /^(?:yes|yeah|yep|si|sí|sim|claro|correcto|tengo|have it|i do|i have|i can|i could|could|can|puedo|podr[ií]a|es posible|possible|con (?:este|ese) monto|(?:este|ese) monto|con (?:esta|esa) cantidad|(?:esta|esa) cantidad)(?=[\s,.;!?]|$)/i;
const OFFLEASE_FINANCING_RANGE = /\$?1(?:[,.]?000)\s*(?:a|to|[-–/])\s*\$?2(?:[,.]?000)\b/i;

function previousFinancingStatus(input: CollectorInput, rawHistory: string, rawMessage: string, memory: string): 'yes' | 'no' | '' {
  const predictorQuestion = clean(input.previous_predicted_bot_question ?? EMPTY);
  const historyQuestions = rawHistory.match(/[^?\n]*\?/g) ?? [];
  const latestTranscriptQuestion = clean(historyQuestions.at(-1) ?? EMPTY);
  const questionAsked = PREVIOUS_FINANCING_QUESTION.test(predictorQuestion || latestTranscriptQuestion);
  const latest = lastMeaningfulLine(rawMessage);
  if (questionAsked && PREVIOUS_FINANCING_NO.test(latest)) return 'no';
  if (questionAsked && PREVIOUS_FINANCING_AFFIRMATIVE.test(latest)) return 'yes';

  // Reconciliation only has inbound GHL messages; the bot's financing
  // question is represented by the persisted predictor instead of appearing
  // in the transcript. Recover a standalone answer from that transcript so
  // an earlier "Sí" cannot be lost when later turns were replayed.
  if (questionAsked) {
    const historicalAnswers = rawHistory
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map(clean)
      .filter((line) => line && !line.includes('?') && (PREVIOUS_FINANCING_NO.test(line) || PREVIOUS_FINANCING_AFFIRMATIVE.test(line)));
    const historicalAnswer = historicalAnswers.at(-1) ?? EMPTY;
    if (PREVIOUS_FINANCING_NO.test(historicalAnswer)) return 'no';
    if (PREVIOUS_FINANCING_AFFIRMATIVE.test(historicalAnswer)) return 'yes';
  }

  const historyLines = rawHistory.replace(/\r\n?/g, '\n').split(/\n+/).filter(Boolean);
  const priorHistory = historyLines.slice(0, -1).join('\n');
  const evidenceInput = predictorQuestion && !questionAsked ? priorHistory : rawMessage;
  const evidence = [evidenceInput, memory]
    .map((value) => String(value ?? '').replace(/\r\n?/g, '\n'))
    .flatMap((value) => value.split(/\n+/))
    .map(clean)
    .filter((line) => line && !line.includes('?'))
    .join('; ');
  if (PREVIOUS_FINANCING_NO.test(evidence) && !PREVIOUS_FINANCING_YES.test(evidence)) return 'no';
  if (PREVIOUS_FINANCING_YES.test(evidence)) return 'yes';
  const memoryAnswer = memoryValue(memory, ['previous_financing', 'previous financing', 'financing history', 'historial de financiamiento', 'has financed before']);
  if (/^(?:yes|si|sí|true)$/i.test(memoryAnswer)) return 'yes';
  if (/^(?:no|false)$/i.test(memoryAnswer)) return 'no';
  return '';
}

/** Recover Stafford's outbound financing answer from inbound-only history. */
function recoverStaffordPreviousFinancing(rawHistory: string, policy: CollectorFlowPolicy, channel: string | null | undefined): 'yes' | '' {
  if (!policy.stafford || !isWhatsAppChannel(channel)) return '';
  const lines = rawHistory.replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter(Boolean);
  if (!ECONOMIC_SEDAN_INTENT.test(rawHistory) || !lines.some((line) => /^\$?1[,.]?000(?:\s+m[aá]xim(?:o|um))?$/i.test(line))) return '';
  const timelineIndex = lines.findIndex((line) => Boolean(extractTimeline(line)));
  const beforeTimeline = timelineIndex >= 0 ? lines.slice(0, timelineIndex) : lines;
  return beforeTimeline.some((line) => /^(?:yes|yeah|yep|si|sí|claro|correcto|tengo)$/i.test(line)) ? 'yes' : '';
}

// HighLevel sometimes exposes a technical profile label as the Messenger
// contact name. It is not buyer identity evidence and must never be persisted
// as the lead's real name.
const INVALID_REAL_NAMES = new Set(['.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'location', 'whatsapp', 'facebook', 'saludos', 'hello', 'hi', 'hey', 'hola', 'ola', 'greetings', 'thu chikitha linda']);
const BUSINESS_NAME_MARKERS = /\b(?:auto\s*sales|motors?|dealership|dealer|llc|inc(?:orporated)?|corp(?:oration)?|company|tatuajes?|tattoos?|operaciones?|operations?|transport(?:ation)?|logistics|construction|remodeling|roofing|realty|consulting|services?|servicios?|shop|tienda|salon|barbershop|restaurant)\b/i;
const QUALIFICATION_RESPONSE_MARKERS = /\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|now if possible|if possible now|ahora si se puede|si es posible ahora|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|siguiente semana|next month|pr[oó]ximo mes|siguiente mes|baltimore|maryland|where are you located|where are you|what|which|how|d[oó]nde est[aá]n ubicad[oa]s?|d[oó]nde est[aá]n|qué|que|ubicaci[oó]n|ubicados?|cu[aá]l(?:\s+ser[ií]a)?|ser[ií]a|gracias|thank you|thank|vehicle|car|auto|carro|coche|veh[ií]culo|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|requirements?|requisitos?|yes|yeah|yep|sim|correct|tengo|tiene|have it|i have|i'm looking|im looking|looking for|busco|buscando|quiero|want|interested|si|sí|no|no tengo|papeles?|aplicar|apply|perfecto|perfect|claro|bien|bueno)\b/i;
const GENERIC_VEHICLE_INTENT = /\b(?:need|needs|looking\s+for|want|wants|seeking|shopping\s+for|trying\s+to\s+find|necesito|busco|buscando|quiero|me\s+interesa)\b[\s\S]*\b(?:vehicle|car|auto|carro|coche|veh[ií]culo|truck|suv|sedan|van|camioneta|pickup|pick-up)\b/i;
const SINGLE_WORD_NAME_BLOCKLIST = /^(?:ok(?:ay)?|si|s[ií]|sim|yes|no|yeah|yep|correct|cash|today|hoy|now|ahora|asap|inmediato|need|vehicle|car|auto|carro|coche|veh[ií]culo|requirements?|requisitos?|information|informaci[oó]n|details?|detalles?|location|baltimore|maryland|virginia|laurel|rosedale|sterling|elkton|manda|nada|bale|vale|ubicaci[oó]n|ubicasion|tacoma|toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion|mustang|rav4|civic|accord|camry|corolla|highlander|sienna|4runner|tundra|sequoia|prius|avalon|maverick|ranger|bronco|explorer|expedition|escape|edge|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|range rover|defender|rlx|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|financiar|finance|financing|down|payment|enganche|documents?|documentos?|identificaci[oó]n|income|ingresos|proof|prueba|phone|tel[eé]fono|number|n[uú]mero)$/i;
const NAME_DECLARATION = /(?:me llamo|mi nombre es|soy|yo soy|my name is|my name['’]s|i am|i['’]m|this is|call me(?!\s+at\b)|ll[aá]mame)\s+([a-záéíóúüñ][a-záéíóúüñ' -]{1,80})/i;
const PHONE_LIKE_TEXT = /\b(?:mi|my)\s+(?:n[uú]mero|number|phone|tel[eé]fono|telephone|contact)\b/i;
const NAME_PARTICLES = new Set(['da', 'de', 'del', 'der', 'di', 'la', 'las', 'los', 'van', 'von', 'y']);
const NON_VEHICLE_INTENT_VALUES = /^(?:(?:(?:quiero|necesito|me gustar[ií]a|me interesa)\s+)?(?:m[aá]s\s+)?(?:informaci[oó]n|info|detalles?|details?|information)|more\s+(?:information|info|details?)|learn\s+more)$/i;
const VEHICLE_BRANDS = /\b(?:toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|land rover|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion)\b/i;
const VEHICLE_MODELS = /\b(?:grand caravan|grand cherokee|transit connect|promaster city|mustang|tacoma|tacma|rav\s*4|civic|civc|accord|camry|coroll?a|highlander|hilander|sienna|4\s*runner|tundra|sequoia|prius|avalon|f-?150|f-?250|f-?350|maverick|ranger|bronco|explorer|expedition|escape|edge|cr-?v|hr-?v|pilot|passport|ridgeline|odyssey|odisea|paila|sierra|silverado|tahoe|tajo|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|rlx|model [3syx]|f-?type|range rover|defender|wrx|highlander)\b/i;
const VEHICLE_CATEGORIES = /\b(?:suv|sedan|truck|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camion|camión)\b/i;
const VEHICLE_TRIMS = /\b(?:\d+\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\b/i;
const VEHICLE_CONTEXT = /\b(?:tengo|tiene|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en|estou procurando|estou [àa] procura|procuro|tenho interesse)\b/i;
// Stafford's WhatsApp flow commonly answers the vehicle-type prompt with
// "Algo económico" followed by "Normal". Treat that exact economic intent as
// a sedan category so a late reconciliation cannot leave the lead as advisor
// handoff after GHL has already completed the flow.
const ECONOMIC_SEDAN_INTENT = /\b(?:carro|auto|coche|veh[ií]culo|algo)\s+econ[oó]mic[oa]s?\b/i;
const NO_DOWN_PAYMENT_RESPONSE = /\b(?:no(?:\s+\w+){0,3}\s+(?:down(?:\s+payment)?|enganche|pago\s+inicial|dinero)|sin\s+(?:down|enganche|pago\s+inicial)|zero\s+down|\$?0\s*(?:down|enganche|pago\s+inicial)|no\s+(?:cuento|cuenta)\s+con\s+(?:dinero|down|enganche|pago\s+inicial))\b/i;
const TRADE_IN_INTENT = /\btrade[- ]?in\b|\bmy (?:car|vehicle|van|truck)\b|\bmi (?:carro|auto|veh[ií]culo|van|troca|camioneta|camioneta|camion)\b|\bcarro como enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\bchange\s+(?:my\s+)?(?:vehicle|car|van|truck)\b|\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b/i;

function canonicalVehicleLabel(value: string): string {
  const normalized = clean(value)
    .replace(/-{2,}/g, '-')
    .replace(/\bcorola\b/gi, 'Corolla')
    .replace(/\bcivc\b/gi, 'Civic')
    .replace(/\bacoitd\b/gi, 'Accord')
    .replace(/\btacma\b/gi, 'Tacoma')
    .replace(/\bodisea\b/gi, 'Odyssey')
    .replace(/\bpaila\b/gi, 'Pilot')
    .replace(/\btajo\b/gi, 'Tahoe')
    .replace(/\brav\s*4\b/gi, 'RAV4')
    .replace(/\b4\s*runner\b/gi, '4Runner')
    .replace(/\bhilander\b/gi, 'Highlander')
    .replace(/\bcrv\b/gi, 'CR-V')
    .replace(/\bhrv\b/gi, 'HR-V');
  const canonicalToken = (token: string): string => {
    const lower = token.toLocaleLowerCase();
    if (lower === 'gmc' || lower === 'bmw' || lower === 'vw') return lower.toLocaleUpperCase();
    if (lower === 'rav4') return 'RAV4';
    if (lower === '4runner') return '4Runner';
    if (lower === 'rlx') return 'RLX';
    if (lower === 'cr-v' || lower === 'hr-v') return lower.toLocaleUpperCase();
    if (/^f-?\d+$/.test(lower)) return lower.replace(/^f-?/, 'F-');
    return `${lower[0].toLocaleUpperCase()}${lower.slice(1)}`;
  };
  return normalized
    .replace(VEHICLE_BRANDS, (match) => canonicalToken(match))
    .replace(VEHICLE_MODELS, (match) => match.split(/\s+/).map(canonicalToken).join(' '));
}

function canonicalVehicleCategory(value: string): string {
  return clean(value).replace(/\b(?:troca|trokita|troquita|troque|trokas|camioneta|camion|camión)\b/gi, 'truck');
}

function extractVehicleLabel(value: string | null | undefined): string {
  const source = clean(value)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:tengo|tiene|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en|estou procurando|estou [àa] procura|procuro|tenho interesse)\b/gi, ' ')
    .replace(/\b(?:a|an|un|una|my|mi|the|carro|auto|car|vehicle|veh[ií]culo)\b/gi, ' ')
    .replace(/[!?.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return EMPTY;
  const brandMatch = source.match(VEHICLE_BRANDS);
  const modelMatch = source.match(VEHICLE_MODELS);
  const categoryMatch = source.match(VEHICLE_CATEGORIES);
  const firstMatch = [
    brandMatch ? { kind: 'brand', match: brandMatch } : null,
    modelMatch ? { kind: 'model', match: modelMatch } : null,
    categoryMatch ? { kind: 'category', match: categoryMatch } : null,
  ].filter(Boolean).sort((left, right) => (left?.match.index ?? 0) - (right?.match.index ?? 0))[0];
  if (!firstMatch) return EMPTY;
  if (firstMatch.kind === 'brand') {
    const brand = firstMatch.match[0];
    const afterBrand = source.slice((source.toLocaleLowerCase().indexOf(brand.toLocaleLowerCase()) + brand.length)).trim();
    const modelAfterBrand = afterBrand.match(VEHICLE_MODELS);
    if (modelAfterBrand?.index !== undefined) {
      const model = modelAfterBrand[0];
      const afterModel = afterBrand.slice(modelAfterBrand.index + model.length);
      const trim = afterModel.match(/^\s+(?:(?:con|with)\s+(?:(?:el|la|the)\s+)?(?:(?:paquete|package)\s+)?)?(\d+\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\b/i)?.[1];
      const category = afterModel.match(VEHICLE_CATEGORIES)?.[0];
      return canonicalVehicleLabel(`${brand} ${model}${trim ? ` ${trim}` : EMPTY}${category ? ` ${category}` : EMPTY}`);
    }
    const suffixTokens = afterBrand.split(/\s+/).filter(Boolean);
    const stopWords = new Set(['this', 'next', 'today', 'hoy', 'week', 'month', 'for', 'and', 'y', 'that', 'que']);
    const suffix = suffixTokens.slice(0, 2).filter((token) => !stopWords.has(token.toLocaleLowerCase())).join(' ');
    return canonicalVehicleLabel(`${brand} ${suffix}`);
  }
  if (firstMatch.kind === 'model') {
    const model = firstMatch.match[0];
    const afterModel = source.slice((firstMatch.match.index ?? 0) + model.length);
    const trim = afterModel.match(/^\s+(?:(?:con|with)\s+(?:(?:el|la|the)\s+)?(?:(?:paquete|package)\s+)?)?(\d+\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\b/i)?.[1];
    return canonicalVehicleLabel(`${model}${trim ? ` ${trim}` : EMPTY}`);
  }
  return canonicalVehicleCategory(firstMatch.match[0]);
}

function extractExplicitVehicleTrim(value: string, label: string): string {
  const model = label.match(VEHICLE_MODELS)?.[0];
  if (!model || VEHICLE_TRIMS.test(label)) return EMPTY;
  const escapedModel = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.match(new RegExp(`\\b${escapedModel}\\b\\s+(?:con|with)\\s+(?:(?:el|la|the)\\s+)?(?:(?:paquete|package)\\s+)?(\\d+\\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\\b`, 'i'))?.[1] ?? EMPTY;
}

function isVehicleStatement(value: string | null | undefined): boolean {
  const candidate = clean(value);
  if (!candidate) return false;
  const label = extractVehicleLabel(candidate);
  if (!label) return false;
  const withoutContext = candidate
    .replace(/\b(?:tengo|tiene|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/gi, ' ')
    .replace(/\b(?:a|an|un|una|my|mi|the|carro|auto|car|vehicle|veh[ií]culo)\b/gi, ' ')
    .replace(/[!?.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return VEHICLE_CONTEXT.test(candidate) || withoutContext.toLocaleLowerCase() === label.toLocaleLowerCase();
}

function formatPersonalName(value: string): string {
  if (isLikelyBusinessName(value) || !/^[a-záéíóúüñ][a-záéíóúüñ' -]*$/i.test(value)) return value;
  return value.split(/\s+/).map((part, index) => {
    const lower = part.toLocaleLowerCase();
    if (index > 0 && NAME_PARTICLES.has(lower)) return lower;
    return lower.split(/([-'])/).map((piece) => /[-']/.test(piece) ? piece : piece ? `${piece[0].toLocaleUpperCase()}${piece.slice(1)}` : piece).join('');
  }).join(' ');
}

export function normalizeRealName(value: string | null | undefined): string {
  const candidate = clean(value);
  if (!candidate || INVALID_REAL_NAMES.has(candidate.toLowerCase())) return EMPTY;
  if (PHONE_LIKE_TEXT.test(candidate) || candidate.replace(/\D/g, '').length >= 7) return EMPTY;
  if (!/[a-záéíóúüñ]/i.test(candidate) || /^[\W_\d]+$/u.test(candidate)) return EMPTY;
  // Qualification answers can look like names (for example "En este mes").
  // Never promote a timeline, location, vehicle category, or yes/no answer
  // into the contact's real name.
  if (QUALIFICATION_RESPONSE_MARKERS.test(candidate) || GENERIC_VEHICLE_INTENT.test(candidate) || isVehicleStatement(candidate)) return EMPTY;
  if (candidate.length > 100 || candidate.split(/\s+/).length > 8) return EMPTY;
  return formatPersonalName(candidate);
}

/**
 * GHL/Messenger contacts can use a business profile as their visible name.
 * Keep it as a useful fallback, but do not let it override a person who
 * identifies themselves in the conversation.
 */
export function isLikelyBusinessName(value: string | null | undefined): boolean {
  return BUSINESS_NAME_MARKERS.test(clean(value));
}

function isLikelyProfileDisplayName(value: string | null | undefined): boolean {
  return /[^\p{L}\p{M}\s.'-]/u.test(clean(value));
}

function extractRealNameFromText(value: string): string {
  const segments = String(value ?? '').replace(/\r\n?/g, '\n').split(/[\n.!?;]+/).map(clean).filter(Boolean);
  for (const segment of segments) {
    const explicit = segment.match(NAME_DECLARATION);
    const named = normalizeRealName(explicit?.[1]);
    if (named) return named;

    // After the bot asks for a full name, people commonly answer with only
    // "First Last". Accept that narrow shape, but never turn vehicle/intent
    // messages into a name before the collector persists it to the contact.
    const candidate = segment.replace(/[.!?,;:]+$/g, '');
    const isTitleCasedToken = candidate[0] === candidate[0].toLocaleUpperCase() || candidate === candidate.toLocaleUpperCase();
    const isOneWordName = /^[a-záéíóúüñ][a-záéíóúüñ'-]{1,39}$/i.test(candidate)
      && isTitleCasedToken
      && !SINGLE_WORD_NAME_BLOCKLIST.test(candidate);
    const isFullName = /^[a-záéíóúüñ][a-záéíóúüñ'-]*(?:\s+[a-záéíóúüñ][a-záéíóúüñ'-]*){1,3}$/i.test(candidate);
    if (!isOneWordName && !isFullName) continue;
    // Speech-to-text often splits a WhatsApp sentence into title-cased words
    // ("Manda. Una. Ubicasion" / "No. Bale. Nada"). Those words are not a
    // declared name; prefer the actual standalone name later in the transcript.
    const previousSegment = segments[segments.indexOf(segment) - 1] ?? EMPTY;
    const nextSegment = segments[segments.indexOf(segment) + 1] ?? EMPTY;
    if (isOneWordName && (/(?:^|\s)(?:no|not|manda|send|give)\s*$/i.test(previousSegment)
      || /^(?:una?|nada|vale|bale|ubicaci[oó]n)$/i.test(nextSegment))) continue;
    if (GENERIC_VEHICLE_INTENT.test(candidate) || /\b(?:quiero|busco|necesito|tengo|carro|auto|veh[ií]culo|suv|sedan|truck|troca|camioneta|pickup|van|financiar|finance|down|payment|hoy|today|yes|no)\b/i.test(candidate)) continue;
    const name = normalizeRealName(candidate);
    if (name) return name;
  }
  return EMPTY;
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /^(?:quiero mi auto con eastern|quiero (?:un )?auto hoy|i want (?:a )?car today|quiero financiar un auto(?: con ustedes)?|me gustaria financiar un auto(?: con ustedes)?|financiar un auto(?: con ustedes)?|(?:quiero )?financiar con easterns?)$/.test(normalized);
}

function isNonVehicleIntent(value: string): boolean {
  const normalized = clean(value).replace(/[!?.,]/g, '').trim();
  return NON_VEHICLE_INTENT_VALUES.test(normalized);
}

function stripCampaignButtonPhrases(value: string): string {
  return value
    .replace(/\bquiero mi auto con eastern\b/gi, ' ')
    .replace(/\bquiero (?:un )?auto hoy\b/gi, ' ')
    .replace(/\bi want (?:a )?car today\b/gi, ' ')
    .replace(/\bquiero financiar un auto(?: con ustedes)?\b/gi, ' ')
    .replace(/\bme gustar[ií]a financiar un auto(?: con ustedes)?\b/gi, ' ')
    .replace(/\b(?:quiero )?financiar con easterns?\b/gi, ' ');
}

function normalizeAmount(value: string): string {
  const source = clean(value).toLowerCase();
  if (!source || isEmptyMarker(source)) return EMPTY;
  if (NO_DOWN_PAYMENT_RESPONSE.test(source)) return 'No down payment';
  if (TRADE_IN_INTENT.test(source)) {
    const withoutTradeIn = source
      .replace(TRADE_IN_INTENT, '')
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
  if (/\b(?:cash|contado|efectivo|paid in full|paga(?:r)? de contado)\b/i.test(source)) return CASH_DOWN_PAYMENT;

  const compact = source.replace(/\$/g, '').replace(/,/g, '').trim();
  if (!compact || /^[.]+$/.test(compact)) return EMPTY;
  // Spanish-language conversations commonly use a dot as the thousands
  // separator: "1.500" means 1500, not 1.5. Keep decimal/k formats below.
  const dottedThousands = compact.match(/^\d{1,3}(?:\.\d{3})+$/);
  if (dottedThousands) return String(Number(compact.replace(/\./g, '')));
  const kMatch = compact.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kMatch) return String(Math.round(Number(kMatch[1]) * 1000));

  const amountMatch = compact.match(/^(\d+(?:\.\d+)?)\s*(?:dollars?|d[oó]lar(?:es|e)?|usd)?$/i);
  if (amountMatch) return String(Math.round(Number(amountMatch[1])));

  const thousandMatch = source.match(/\b(\d{1,2})\s*(?:mil|thousand)\b/i);
  if (thousandMatch) return String(Number(thousandMatch[1]) * 1000);
  const words: Record<string, number> = {
    hundred: 100,
    thousand: 1000,
    mil: 1000,
    'one thousand': 1000,
    'a thousand': 1000,
    'un mil': 1000,
    'mil quinientos': 1500,
    'one thousand five hundred': 1500,
    'dos mil': 2000,
    'two thousand': 2000,
    'dos mil quinientos': 2500,
    'two thousand five hundred': 2500,
    'tres mil': 3000,
    'three thousand': 3000,
    'tres mil quinientos': 3500,
    'three thousand five hundred': 3500,
    'cuatro mil': 4000,
    'four thousand': 4000,
    'cinco mil': 5000,
    'five thousand': 5000,
    'seis mil': 6000,
    'six thousand': 6000,
    'siete mil': 7000,
    'seven thousand': 7000,
    'ocho mil': 8000,
    'eight thousand': 8000,
    'nueve mil': 9000,
    'nine thousand': 9000,
    'diez mil': 10000,
    'ten thousand': 10000,
  };
  for (const [phrase, amount] of Object.entries(words).sort((left, right) => right[0].length - left[0].length)) {
    if (source.includes(phrase)) return String(amount);
  }
  return clean(value);
}

function normalizeMemoryDownPayment(value: string): string {
  const source = clean(value);
  if (!source) return EMPTY;
  const tradeIn = TRADE_IN_INTENT.test(source);
  const amount = source.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k?|\d{1,2}\s*(?:mil|thousand)|mil(?:\s+quinientos)?|(?:un|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\s+mil(?:\s+(?:quinientos|five hundred))?)\b/i)?.[1];
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
  let source = clean(value).replace(/-{2,}/g, '-').replace(/(?:19|20)\d{2}(?:\d{2})*$/i, '').trim();
  if (isAdvisorHandoffVehicle(source)) return ADVISOR_HANDOFF_VEHICLE;
  if (isCampaignButton(source) || isNonVehicleIntent(source)) return EMPTY;
  // HighLevel can concatenate the Custom Code output and the AI output
  // without a separator. Keep the value before a repeated label such as
  // "Toyota HilanderVehicle: Toyota HilanderToyota Hilander".
  const labeled = source.match(/^(.+?)\s*vehicle(?:_type)?\s*:\s*(.+)$/i);
  if (labeled?.[1]) source = labeled[1].trim();
  const doubled = source.match(/^(.{2,}?)\1$/i);
  if (doubled?.[1]) source = doubled[1].trim();
  if (!source) return EMPTY;
  // Only retain structured values when they still contain a recognized
  // vehicle token. The previous fallback returned any arbitrary text from
  // vehicle_type, which could turn intent/narrative into a queue label.
  if (source.includes('—')) {
    return VEHICLE_BRANDS.test(source) || VEHICLE_MODELS.test(source) || VEHICLE_CATEGORIES.test(source) ? source : EMPTY;
  }
  const extractedLabel = extractVehicleLabel(source);
  if (extractedLabel) return extractedLabel;
  const lower = source.toLowerCase();
  const category = lower.match(/\b(suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camion|camión|carro|auto|coche)\b/i)?.[1];
  const brand = source.match(/\b(toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|land rover|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion)\b/i)?.[1];
  if (category && brand) return `${category.replace('troca', 'truck')} — ${source}`;
  if (category && clean(source).toLocaleLowerCase() === category.toLocaleLowerCase()) {
    return category.replace(/^troca$/i, 'truck').replace(/^camion(?:eta)?$/i, 'truck').replace(/^camión(?:eta)?$/i, 'truck');
  }
  return EMPTY;
}

function extractVehicle(message: string): string {
  const source = String(message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return EMPTY;
  const lines = source.split(/\n+/).map(clean).filter(Boolean);
  const candidates: Array<{ label: string; score: number; lineIndex: number; hasModel: boolean; brand: string; isColloquialTruck: boolean }> = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const candidate = stripCampaignButtonPhrases(line);
    if (!candidate || isCampaignButton(candidate) || isNonVehicleIntent(candidate)) continue;
    // Internal structured fields can appear beside the buyer's evidence. They
    // describe a field, not a new vehicle answer, and must not override the
    // actual vehicle with a later `vehicle_type: SUV` marker.
    if (/^\s*(?:vehicle_type|vehicle_category)\s*[:=]/i.test(candidate)) continue;
    // A trade-in vehicle is evidence for the down-payment/trade-in field, not
    // the vehicle the lead wants to buy. Keep the requested category/model
    // separate from the vehicle they are offering.
    if (TRADE_IN_INTENT.test(candidate)
      && /\b(?:tengo|tiene|have|has|my|mi)\b/i.test(candidate)
      && !/\b(?:looking for|busco|quiero|want|interested in|interesado en)\b/i.test(candidate)) continue;
    const candidateForVehicle = /\b(?:looking for|busco|quiero|want|interested in|interesado en|estou procurando|estou [àa] procura|procuro|tenho interesse)\b/i.test(candidate)
      ? candidate
      : candidate.split(/[;,]/, 1)[0];
    const withoutOtherFacts = candidateForVehicle
      .replace(/(?:\+?1[\s().-]*)?(?:\(?[2-9]\d{2}\)?[\s.-]*)\d{3}[\s.-]?\d{4}/g, ' ')
      .replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?\s*[\d,.]+\s*k?/gi, '')
      .replace(/\b(?:today|hoy|asap|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|siguiente semana|next month|pr[oó]ximo mes|siguiente mes)\b/gi, '')
      // Keep comma-separated natural language such as "Soy Ana, busco un Civic".
      // Semicolon remains the transcript separator used to stop at the next field.
      .split(/;/, 1)[0]
      .trim();
    const requested = withoutOtherFacts.match(/(?:looking for|busco|quiero|want|interested in|interesado en|estou procurando|estou [àa] procura|procuro|tenho interesse)\s+(?:a|an|un|una|um|uma)?\s*([^.!?]+)/i)?.[1];
    if (requested && !isNonVehicleIntent(requested)) {
      const requestedLabel = extractVehicleLabel(requested);
      if (requestedLabel) {
        candidates.push({
          label: requestedLabel,
          score: 100 + (VEHICLE_MODELS.test(requested) ? 25 : 0) + lineIndex / 1000,
          lineIndex,
          hasModel: VEHICLE_MODELS.test(requested),
          brand: requested.match(VEHICLE_BRANDS)?.[0] ?? EMPTY,
          isColloquialTruck: false,
        });
      }
    }
    // A transcript can contain several facts (for example "Sedan" followed by
    // a Subaru trade-in). Return the vehicle token, never the complete transcript.
    const category = withoutOtherFacts.match(/\b(suv|sedan|truck|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto)\b/i)?.[1];
    const transcriptionModelAlias = /\b(?:odisea|paila|tajo)\b/i.test(candidate);
    const hasModel = VEHICLE_MODELS.test(withoutOtherFacts) || transcriptionModelAlias;
    const brand = withoutOtherFacts.match(VEHICLE_BRANDS)?.[0] ?? EMPTY;
    // Whisper often places a recognized model after a comma while the first
    // clause contains the answer intent (for example: "tres filas..., odisea").
    // Keep the boundary protection above for payment/location facts, but use
    // the complete candidate when it contains a known model.
    const label = extractVehicleLabel(transcriptionModelAlias ? candidate : withoutOtherFacts);
    const followsVehicleQuestion = lineIndex > 0 && /\b(?:what|which)\s+(?:vehicles?|cars?|trucks?)|\b(?:qu[eé]|cu[aá]l)\s+(?:veh[ií]culos?|carros?|autos?)\b/i.test(lines[lineIndex - 1]);
    if (label && (category || VEHICLE_CONTEXT.test(candidate) || followsVehicleQuestion || VEHICLE_BRANDS.test(candidate) || hasModel || VEHICLE_CATEGORIES.test(candidate))) {
      const lowQualityNarrative = /\b(?:seg[uú]n|anuncio|anuncios|variedad|maneja|manejan|opciones|informaci[oó]n)\b/i.test(candidate);
      const score = (hasModel ? 80 : category ? 25 : brand ? 15 : 0)
        + (VEHICLE_CONTEXT.test(candidate) ? 10 : 0)
        + (followsVehicleQuestion ? 10 : 0)
        - (lowQualityNarrative && !hasModel ? 30 : 0)
        + lineIndex / 1000;
      candidates.push({
        label,
        score,
        lineIndex,
        hasModel,
        brand,
        isColloquialTruck: /\b(?:troca|trokita|troquita|troque|trokas)\b/i.test(candidate),
      });
    }
  }
  // A buyer can change the vehicle during the same conversation. The last
  // explicit vehicle answer is the active choice, so the down payment must be
  // evaluated against that answer rather than an earlier, more specific model.
  const latest = candidates.sort((left, right) => right.lineIndex - left.lineIndex || right.score - left.score)[0];
  // Whisper often produces a standalone colloquial truck token after the
  // requested model. Preserve that more specific model when it is clearly
  // the same answer sequence; an explicit later Sedan/SUV/etc. still wins.
  const best = latest?.isColloquialTruck && !latest.hasModel
    ? candidates.find((candidate) => candidate.hasModel && candidate.lineIndex < latest.lineIndex) ?? latest
    : latest;
  if (!best) return EMPTY;
  // Combine a make from one answer with a more specific model from a later
  // answer, without promoting narrative text such as "chevrolet según su".
  const brands = [...new Set(candidates.map((candidate) => candidate.brand).filter(Boolean).map((brand) => brand.toLocaleLowerCase()))];
  if (!VEHICLE_BRANDS.test(best.label) && brands.length === 1 && (best.hasModel || latest?.isColloquialTruck)) {
    const brand = candidates.find((candidate) => candidate.brand && candidate.brand.toLocaleLowerCase() === brands[0])?.brand ?? brands[0];
    const combined = clean(`${brand} ${best.label}`);
    const trim = extractExplicitVehicleTrim(source, combined);
    return clean(`${combined}${trim ? ` ${trim}` : EMPTY}`).replace(/\b([a-z]+)\b/gi, (token) => token[0].toLocaleUpperCase() + token.slice(1).toLocaleLowerCase()).replace(/\b(\d)\s*lt\b/gi, '$1LT');
  }
  const normalizedBest = clean(best.label);
  const trim = extractExplicitVehicleTrim(source, normalizedBest);
  return clean(`${normalizedBest}${trim ? ` ${trim}` : EMPTY}`).replace(/\b(\d)\s*lt\b/gi, '$1LT');
}

function extractDownPayment(message: string): string {
  // Keep message boundaries intact: a down-payment phrase must not borrow the
  // first three digits from a phone on the next inbound line.
  const source = String(message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || isCampaignButton(source)) return EMPTY;
  if (NO_DOWN_PAYMENT_RESPONSE.test(source)) return 'No down payment';
  if (/\b(?:cash|contado|efectivo|paid\s+in\s+full|paga(?:r)?\s+de\s+contado)\b/i.test(source)) return CASH_DOWN_PAYMENT;
  const amountToken = '(?:\\d{1,3}(?:,\\d{3})+|\\d{1,2}\\s*(?:mil|thousand)|mil(?:\\s+quinientos)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+(?:mil|thousand)(?:\\s+(?:quinientos|five hundred))?|\\d+(?:[,.]\\d+)?\\s*k?)(?:\\s*d[oó]lar(?:es|e)?)?';
  const amount = source.match(new RegExp(`(?:down|enganche|inicial|deposit|dep[oó]sito)[ \\t]*(?:payment|pago)?[ \\t]*(?:is|es|de|:)?[ \\t]*\\$?[ \\t]*(${amountToken})`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\$?[ \\t]*(${amountToken})[ \\t]*(?:(?:for|para|as|on|de|del)[ \\t]*(?:el|la|the)?[ \\t]*)?(?:down|enganche|inicial)`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:tengo|have|i have|i can put|puedo poner)[ \\t]+(?:down[ \\t]+)?(?:a[ \\t]+)?\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:cuento|cuenta)[ \\t.,;:]+con[ \\t.,;:]*\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:cuento|cuenta)\\b[^\\n]{0,80}?(?:y|and|plus)[ \\t.,;:]*\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:puedo|puede|can|could|i can|i could)[ \\t]+(?:con|with)[ \\t]+\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    // A buyer may answer the minimum prompt with a short amount confirmation
    // such as "1.500 está perfecto". Require a line-leading amount and a
    // confirmation phrase so prices, years, and unrelated numbers do not leak
    // into the down-payment field.
    ?? source.match(new RegExp(`(?:^|\\n)\\$?[ \\t]*(${amountToken})[ \\t]*(?:d[oó]lares?|usd)?[ \\t]*(?:est[aá]\\s+(?:perfecto|bien)|perfecto|bien|ok(?:ay)?|works?(?:\\s+for\\s+me)?|is\\s+(?:fine|perfect|okay))\\b`, 'i'))?.[1];
  return amount ? normalizeAmount(amount) : EMPTY;
}

const AFFIRMATIVE_DOWN_CONFIRMATION = /^(?:yes|yeah|yep|correct|that's right|thats right|si|claro|correcto|okay|ok|bien|esta bien|seria bien|me parece bien|that works|works for me)(?:\s+(?:yes|yeah|yep|si|claro|correcto|okay|ok))*?(?:\s+(?:eso|that|works|for me))?$/i;
const REFERENCED_DOWN_CONFIRMATION = /^(?:(?:si|claro|correcto|ok(?:ay)?|bien)[,\s]+)?(?:con\s+(?:ese|este)\s+(?:monto|enganche|down)|con\s+(?:esa|esta)\s+cantidad|(?:ese|este)\s+(?:monto|enganche|down)|(?:esa|esta)\s+cantidad|con\s+eso|with\s+that\s+(?:amount|down)|that\s+(?:amount|down))(?:\s+(?:si|s[ií]\s+lo\s+tengo|s[ií]\s+puedo|esta\s+bien|est[aá]\s+bien|works?|is\s+(?:fine|okay|perfect)))?$/i;
const DOWN_CONTEXT_MARKERS = /\b(?:down|payment|enganche|pago\s+inicial|dinero|cash|contado|trade[- ]?in|tradein|m[ií]nimo|minimum|required|conseguir|bring|subir|subirle|raise|increase|m[aá]s|more)\b/i;
const NON_DOWN_AFFIRMATION_CONTEXT = /\b(?:phone|number|n[uú]mero|tel[eé]fono|document|documentos?|identificaci[oó]n|license|licencia|income|ingresos?|proof|prueba|bank|banco|cuenta|vehicle|veh[ií]culo|carro|auto|suv|sedan|truck|troca|van|hoy|today|semana|week|mes|month|ubicad|located|location)\b/i;

function affirmativeDownConfirmation(value: string): boolean {
  const source = clean(value);
  if (!source || source.length > 120 || NON_DOWN_AFFIRMATION_CONTEXT.test(source)) return false;
  const compact = source
    .replace(/[.,!?¡¿-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (AFFIRMATIVE_DOWN_CONFIRMATION.test(compact)
    || REFERENCED_DOWN_CONFIRMATION.test(compact)
    || /^(?:bien|esta bien|seria bien|me parece bien|that works|works for me)(?=\s|$)/i.test(compact)) {
    return true;
  }
  // A shortfall answer commonly adds the action to the confirmation:
  // "sí, puedo subirle" / "yes, I can raise it". Keep this constrained to
  // an affirmative prefix plus an explicit increase/ability phrase so a
  // generic "sí" cannot qualify a down payment by itself.
  return /^(?:yes|yeah|yep|si|claro|correcto|okay|ok|bien|esta bien|seria bien|me parece bien)(?=\s|$)(?:\s+(?:yes|yeah|yep|si|claro|correcto|okay|ok))*\s*(?:puedo|podria|can|could|i can|i could)\b(?:.*\b(?:subir(?:le|lo)?|raise|increase|more|mas|conseguir|get|bring|put)\b.*|\s*)$/i.test(compact);
}

function lastMeaningfulLine(value: string): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean)
    .at(-1) ?? EMPTY;
}

function predictorAskedMinimumQuestion(value: string): boolean {
  const source = clean(value);
  return Boolean(source)
    && /\$?\s*\d[\d,.]*/.test(source)
    && /\b(?:m[ií]nimo|minimum|required)\b/i.test(source)
    && /\b(?:podr[ií]as?|could|can|conseguir|bring|subir(?:le|lo)?|raise|increase|m[aá]s|more|cuent(?:as|a|o|en)|contar(?:[íi]as)?|how\s+much|amount)\b/i.test(source);
}

function extractQuestionedDownPayment(history: string): string {
  const questions = history.match(/[^?\n]*\?/g) ?? [];
  const lastQuestion = questions.at(-1) ?? EMPTY;
  if (!lastQuestion || !DOWN_CONTEXT_MARKERS.test(lastQuestion)) return EMPTY;
  const amountToken = '(?:\\d{1,3}(?:,\\d{3})+|\\d{1,2}\\s*(?:mil|thousand)|mil(?:\\s+quinientos)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+(?:mil|thousand)(?:\\s+(?:quinientos|five hundred))?|\\d+(?:[,.]\\d+)?\\s*k?)(?:\\s*d[oó]lar(?:es|e)?)?';
  const amount = lastQuestion.match(new RegExp(`(?:down|payment|enganche|inicial|deposit|dep[oó]sito|m[ií]nimo|minimum|required)[^?\\n]{0,80}?\\$?[ \\t]*(${amountToken})`, 'i'))?.[1]
    ?? lastQuestion.match(new RegExp(`\\$?[ \\t]*(${amountToken})[^?\\n]{0,80}?(?:down|payment|enganche|inicial|deposit|dep[oó]sito|m[ií]nimo|minimum|required)`, 'i'))?.[1]
    ?? (/(?:conseguir|bring|subir|raise|increase|m[aá]s|more)/i.test(lastQuestion)
      ? lastQuestion.match(new RegExp(`\\$?[ \\t]*(${amountToken})`, 'i'))?.[1]
      : undefined);
  return amount ? normalizeAmount(amount) : EMPTY;
}

function extractTradeInDownPayment(message: string): string {
  const source = clean(message);
  if (!source || isCampaignButton(source)) return EMPTY;
  const tradeIn = TRADE_IN_INTENT.test(source);

  const amountPattern = '(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?|\\d{1,2}\\s*(?:mil|thousand)|mil(?:\\s+quinientos)?|(?:un|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+mil(?:\\s+(?:quinientos|five hundred))?)';
  const tradeInPattern = '(?:trade[- ]?in|my car|my vehicle|my van|my truck|mi carro|mi auto|mi vehículo|mi van|mi troca|mi camioneta|carro como enganche|(?:cambiar|cambio)\\s+(?:(?:mi|el|de)\\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)|change\\s+(?:my\\s+)?(?:vehicle|car|van|truck))';
  const beforeTradeIn = source.match(new RegExp(`\\$?\\s*(${amountPattern})\\s*(?:down|payment|enganche|inicial)?\\s*(?:\\+|and|y)\\s*${tradeInPattern}`, 'i'));
  const afterTradeIn = source.match(new RegExp(
    `${tradeInPattern}\\s*(?:(?:and|plus|with|y|mas|más|con)\\s*(?:put|poner|pay|pagar|give|dar)?\\s*|[^0-9;.!?]{0,16}(?:down|payment|enganche|inicial|deposit|dep[oó]sito)[^0-9;.!?]{0,8})\\$?\\s*(${amountPattern})`,
    'i',
  ));
  const amount = beforeTradeIn?.[1] ?? afterTradeIn?.[1];
  const normalized = amount ? normalizeAmount(amount) : EMPTY;
  return normalized ? `${normalized} + trade-in` : tradeIn ? 'trade-in' : EMPTY;
}

function extractStandaloneDownPayment(message: string): string {
  // Preserve message boundaries so a numeric reply inside a full transcript
  // (for example the standalone "1000" message) is not lost.
  const source = String(message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || isCampaignButton(source)) return EMPTY;
  if (NO_DOWN_PAYMENT_RESPONSE.test(source)) return 'No down payment';
  const safeSource = source.split('\n').filter((line) => !isPhoneOnlyLine(line)).join('\n');
  const matches = [...safeSource.matchAll(/(?:^|\n)\$?[ \t]*(\d{1,3}(?:[,.]\d{3})+|\d+(?:[,.]\d+)?\s*k?|\d{1,2}\s*(?:mil|thousand)|mil(?:\s+quinientos)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\s+(?:mil|thousand)(?:\s+(?:quinientos|five hundred))?)[ \t]*\$?[ \t]*(?:tengo|have|available|disponible|i have|i can put)?[ \t]*\d{0,2}[ \t]*\.?[ \t]*(?=\n|$)/gim)];
  const standalone = matches.reverse().find((match) => !/^20(?:1\d|2\d)$/.test(match[1].replace(/[$,\s]/g, '')));
  if (!standalone) return EMPTY;
  // A standalone recent four-digit answer is a vehicle year, not a down
  // payment. Values such as 1000/2000/3000 remain valid down payments.
  return normalizeAmount(standalone[1]);
}

function extractLatestDownPayment(message: string): string {
  const lines = String(message ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    // Never infer a down payment from a question asked by the bot, or from a
    // stale bot question that appears before a later qualification step.
    const lineDigits = line.replace(/\D/g, '');
    const paymentRange = /\$?\d+(?:[,.]\d+)?\s*(?:a|to|[-–/])\s*\$?\d+(?:[,.]\d+)?/i.test(line);
    if (/[?¿]/.test(line)
      || isPhoneOnlyLine(line)
      || PHONE_LIKE_TEXT.test(line)
      || /\b(?:phone|telephone|tel[eé]fono|n[uú]mero|number)\b/i.test(line)
      || (lineDigits.length >= 7 && !paymentRange)) continue;
    const contextual = extractDownPayment(line);
    if (contextual) return contextual;
    const standalone = extractStandaloneDownPayment(line);
    if (standalone) return standalone;

    // A time range such as "Entre 1:30 a 5pm" is not a payment range. Only
    // the explicit/contextual extraction above may use a line containing a
    // clock time.
    const timeLikeLine = /\b\d{1,2}:\d{2}\b|\b(?:am|pm)\b/i.test(line);
    if (timeLikeLine) continue;

    // Speech-to-text and misspellings often leave the amount in a sentence
    // instead of the exact phrases handled above. In a range, the last value
    // is the buyer's maximum ("1500 a 2000").
    const amountToken = '(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?)';
    const range = [...line.matchAll(new RegExp(`\\$?(${amountToken})\\s*(?:a|to|[-–/])\\s*\\$?(${amountToken})`, 'gi'))]
      .map((match) => normalizeAmount(match[2]))
      .find((amount) => amount && !/^20(?:1\\d|2\\d)$/.test(amount));
    if (range) return range;

    // Keep this deliberately line-scoped and answer-shaped. Requiring a
    // word boundary after the context word prevents "tengo10" from turning
    // the suffix 10 into a payment, while allowing noisy phrases such as
    // "lo maximo ... son $2000" and "Si 2000 esta bien".
    const answerLike = /\b(?:tengo|have|cuento|cuenta|puedo|podr[ií]a|maximum|maximo|m[aá]ximo|son|available|will\s+have|down|payment|enganche|d[oó]lares?|dollars?)\b/i.test(line)
      || /^(?:si|sí|yes|yeah|yep|claro|ok(?:ay)?|bien)\b\s*\$?\d/i.test(line);
    if (!answerLike) continue;
    const amounts = [...line.matchAll(new RegExp(`\\$?(${amountToken})(?!\\d)`, 'gi'))]
      .map((match) => normalizeAmount(match[1]))
      .filter((amount) => amount && !/^20(?:1\\d|2\\d)$/.test(amount));
    if (amounts.length > 0) return amounts.at(-1) ?? EMPTY;
  }
  return EMPTY;
}

function extractTimeline(message: string): string {
  const source = clean(message);
  if (!source) return EMPTY;
  const match = source.match(/\b(?:today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|esta mes|next week|pr[oó]xima? semana|siguiente semana|next month|pr[oó]ximo mes|siguiente mes|within \d+ days?|en \d+ d[ií]as?|in \d+ (?:days?|weeks?|months?)|en \d+ (?:d[ií]as?|semanas?|mes(?:es)?)|in a month|en un mes|in two weeks|en dos semanas)\b/i)?.[0];
  return match ? normalizeTimeline(match) : /\b(?:solo|sólo|just|only)\b.*\b(?:mirar|mirando|ver|viendo|looking|browsing)\b/i.test(source) ? 'exploring options' : EMPTY;
}

function normalizeTimeline(value: string, language: CollectorLanguage = detectLeadLanguage(value)): string {
  const source = clean(value).toLowerCase();
  if (!source) return EMPTY;
  const spanish = language === 'es';
  const localized = (english: string, spanishValue: string): string => spanish ? spanishValue : english;
  if (/\b(today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda)\b/i.test(source)) return 'today';
  if (/\b(this|esta)\s+(week|semana)\b/i.test(source)) return localized('this week', 'esta semana');
  if (/\b(this|este|esta)\s+(month|mes)\b/i.test(source)) return localized('this month', 'este mes');
  if (/\b(?:next|proxim[oa]|pr[oó]xim[oa]|siguiente)\s+(week|semana)\b/i.test(source)) return localized('next week', 'próxima semana');
  if (/\b(?:next|proxim[oa]|pr[oó]xim[oa]|siguiente)\s+(month|mes)\b/i.test(source)) return localized('next month', 'próximo mes');
  if (/\b(30|thirty)\s+days?\b/i.test(source)) return localized('within 30 days', 'en 30 días');
  if (/\b(?:in|en)\s+(?:a|un|one|uno|two|dos|\d+)\s+(?:days?|d[ií]as?|weeks?|semanas?|months?|mes(?:es)?)\b/i.test(source)) return clean(value).toLowerCase();
  if (/\b(?:exploring options|explorando opciones)\b/i.test(source) || /\b(solo|sólo|just|only)\b.*\b(mirar|mirando|ver|viendo|looking|browsing)\b/i.test(source)) return localized('exploring options', 'explorando opciones');
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
  const source = conversationalEvidence(message);
  const currentSource = clean(current);
  const answer = (documentPattern: string): 'yes' | 'no' | '' => {
    const positive = 'yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available';
    const negative = "no|nó|dont|don't|no tengo|i do not|do not have|don't have|not available";
    const context = source.match(new RegExp(`(?:${positive}|${negative})[^!?]{0,160}(?:${documentPattern})|(?:${documentPattern})[^!?]{0,160}(?:${positive}|${negative})`, 'i'))?.[0] ?? '';
    const explicit = yesNo(context);
    if (explicit) return explicit;
    const currentSegment = currentSource.split(/[;,]/).find((segment) => new RegExp(documentPattern, 'i').test(segment)) ?? '';
    if (currentSegment) {
      const currentExplicit = yesNo(currentSegment);
      if (currentExplicit) return currentExplicit;
      return 'yes';
    }
    return '';
  };
  const id = answer('id\\b|identification\\b|identificación\\b|driver.?s license\\b|license\\b|licencia\\b|itin\\b|passport\\b|pasaporte\\b');
  const income = answer('proof of income|income proof|prueba de ingresos|comprobante de ingresos|estados? de cuenta|account statements?|bank statements?|financial statements?|pay stubs?|check stubs?|talones? de pago|colillas? de cheques?|recibos? de n[oó]mina|bank account|cuenta bancaria|cuenta de banco');
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
  const segments = memoryText(current)
    .split(';')
    .map((segment) => clean(segment).replace(/^\d+(?=(?:vehicle|vehicle[_ ]?type|down(?:[_ ]?payment)?|documents?|docs|timeline|purchase[_ ]?timeline)\b)/i, ''))
    .filter((segment) => Boolean(segment) && !/^\$?\d[\d,.]*$/.test(segment));
  for (const [key, value] of Object.entries(values)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segmentKey = segments[index].match(/^[-*•\s]*([^:=-]+)\s*[:=-]/)?.[1]?.toLowerCase().replace(/[^a-z0-9]/g, '');
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
  real_name?: string | null;
  phone?: string | null;
  vehicle_type?: string | null;
  // Retained in the input contract for callers that also build the complete
  // qualification snapshot; these fields are not common routing blockers.
  down_payment?: string | null;
  purchase_timeline?: string | null;
  has_identification?: string | null;
  has_income_proof?: string | null;
  bank_account?: string | null;
}): boolean {
  // The common dealer handoff gate is intentionally small: name, phone, and a
  // real vehicle. Down payment is a policy-specific gate for Offlease only;
  // purchase timing, documents, and bank account remain additive evidence.
  return Boolean(
    clean(input.real_name) &&
    clean(input.phone) &&
    clean(input.vehicle_type) && !isAdvisorHandoffVehicle(input.vehicle_type),
  );
}

/**
 * Minimum data required before a lead may enter dealerADMIN.
 *
 * Qualification fields are optional at intake. They are preserved and
 * normalized when present, but a conversation needs the three routing facts
 * common to every dealer before it can enter dealerADMIN: a usable name, a
 * valid phone, and a real vehicle interest. Offlease adds its vehicle-specific
 * down-payment gate in the conversation status evaluator.
 */
export function hasMinimumRoutingQualification(
  input: Pick<CollectorInput, 'real_name' | 'phone' | 'vehicle_type'>,
): boolean {
  return Boolean(
    firstNonEmpty(input.real_name) &&
    firstNonEmpty(input.phone) &&
    firstNonEmpty(input.vehicle_type)
    && !isAdvisorHandoffVehicle(input.vehicle_type),
  );
}

export function normalizeCollectorInput(input: CollectorInput): CollectorOutput {
  const message = clean(input.message);
  const history = clean(input.chat_history_log);
  const memory = input.qualification_memory?.trim() ?? EMPTY;
  const rawMessage = String(input.message ?? '').replace(/\r\n?/g, '\n').trim();
  const rawHistory = String(input.chat_history_log ?? '').replace(/\r\n?/g, '\n').trim();
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
  const languageText = [history, message].filter(Boolean).join('\n');
  // A memory/custom-field-only payload has no reliable language evidence;
  // keep the established English fallback while transcript replies are
  // detected in Spanish or English.
  const language = languageText ? detectLeadLanguage(languageText) : 'en';
  const policy = collectorFlowPolicy(input);
  const customerLocation = extractCustomerLocation(input, languageText);
  const campaignReply = isCampaignButton(message);
  const messageForExtraction = stripCampaignButtonPhrases(rawMessage);
  const suppliedName = normalizeRealName(input.real_name);
  const extractedNames = [
    realNameFromQualificationMemory(memory),
    extractRealNameFromText(rawMessage),
    extractRealNameFromText(rawHistory),
  ];
  const realName = isMessengerChannel(input.channel)
    // Prefer an explicit name from the conversation. Messenger's profile label
    // remains the fallback, because it can be a business label or a stale
    // workflow response rather than the buyer's actual name.
    ? extractedNames.map(normalizeRealName).find(Boolean) ?? suppliedName
    : isWhatsAppChannel(input.channel)
      // WhatsApp gets a real name only from a declared/repeated name in chat.
      ? extractedNames.map(normalizeRealName).find(Boolean) ?? EMPTY
      : (isLikelyBusinessName(suppliedName) || isLikelyProfileDisplayName(suppliedName)
        ? [...extractedNames, suppliedName]
        : [suppliedName, ...extractedNames]
      ).map(normalizeRealName).find(Boolean) ?? EMPTY;
  const chatPhone = extractPhone(input.chat_history_log) || extractPhone(input.message) || extractPhone(input.phone);
  const phoneFromConversation = extractPhone(input.chat_history_log) || extractPhone(input.message);
  const memoryDown = normalizeMemoryDownPayment(memoryValue(memory, ['down payment', 'down_payment', 'downpayment']));
  const inputDown = clean(input.down_payment ?? EMPTY);
  const vehicleSource = [rawHistory, messageForExtraction].filter(Boolean).join('\n');
  // Buyers on WhatsApp and Messenger use "carro económico" as a category
  // request. Keep this deterministic so it cannot be mistaken for a make/model.
  const extractedVehicle = ECONOMIC_SEDAN_INTENT.test(vehicleSource)
    ? 'Sedan'
    : normalizeVehicle(firstNonEmpty(
      extractVehicle(vehicleSource),
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
  const hasExistingAdvisorMarker = [
    memoryValue(memory, ['vehicle_type', 'vehicle', 'type']),
    input.vehicle_type,
  ].some((value) => isAdvisorHandoffVehicle(value));
  const vehicle = extractedVehicle || (hasExistingAdvisorMarker || phoneFromConversation || (isWhatsAppChannel(input.channel) && chatPhone)
    ? ADVISOR_HANDOFF_VEHICLE
    : EMPTY);
  const hasRealVehicle = Boolean(vehicle) && !isAdvisorHandoffVehicle(vehicle);
  const explicitCashDown = firstValidAmount(
    extractLatestDownPayment(rawMessage),
    extractDownPayment(messageForExtraction),
    extractLatestDownPayment(rawHistory),
  );
  // Some bot prompts ask for confirmation of a concrete minimum (for example
  // "$2,000 ... ¿con cuánto contarías?") and the buyer answers "sí", "sería
  // bien" or an equivalent short affirmation. Treat that answer as the
  // amount asked about only when it is the last down-payment question; a
  // generic "sí" elsewhere must not invent a down payment.
  const latestInboundMessage = lastMeaningfulLine(messageForExtraction);
  const previousFinancing = previousFinancingStatus(input, rawHistory, rawMessage, memory)
    || recoverStaffordPreviousFinancing(rawHistory, policy, input.channel)
    // GHL stores only inbound turns in this transcript. If the bot's financing
    // question is absent, a short affirmative after the recorded $1000-$2000
    // range still identifies the Offlease promotion without replacing the
    // original media message.
    || (policy.offlease && OFFLEASE_FINANCING_RANGE.test(rawHistory) && PREVIOUS_FINANCING_AFFIRMATIVE.test(latestInboundMessage) ? 'yes' : '');
  const confirmedQuestionDown = affirmativeDownConfirmation(latestInboundMessage)
    ? firstNonEmpty(
      extractQuestionedDownPayment(rawHistory),
      extractQuestionedDownPayment(input.previous_predicted_bot_question ?? EMPTY),
    )
    : EMPTY;
  const predictorAskedMinimum = predictorAskedMinimumQuestion(firstNonEmpty(
    input.previous_predicted_bot_question,
    confirmedQuestionDown ? rawHistory : EMPTY,
  ));
  const cashDownCandidate = firstValidAmount(
    explicitCashDown,
    confirmedQuestionDown,
    extractStandaloneDownPayment(rawMessage),
    extractStandaloneDownPayment(rawHistory),
    isPhoneAreaCodeAmount(memoryDown, chatPhone) ? EMPTY : memoryDown,
    campaignReply || isPhoneAreaCodeAmount(inputDown, chatPhone) ? EMPTY : inputDown,
  );
  const cashDown = isPhoneAreaCodeAmount(cashDownCandidate, chatPhone) && !explicitCashDown
    ? EMPTY
    : cashDownCandidate;
  const tradeDown = firstValidAmount(
    extractTradeInDownPayment(messageForExtraction),
    extractTradeInDownPayment(history),
    extractTradeInDownPayment(memoryText(memory)),
  );
  const baseDown = cashDown || tradeDown;
  const conversationalSource = [history, message].filter(Boolean).join('; ');
  let down = baseDown && TRADE_IN_INTENT.test(conversationalSource) && !/trade[- ]?in/i.test(baseDown)
    ? `${baseDown} + trade-in`
    : baseDown;
  let downPaymentRule = evaluateDownPayment(vehicle, down, {
    allowPromotionalThousand: policy.offlease && previousFinancing === 'yes',
  });
  // GHL inbound history does not include the bot's outbound prompt. When the
  // latest inbound turn is an affirmative answer and the buyer already gave
  // an amount below the vehicle minimum, that shortfall is the only reliable
  // field context available. Promote the amount to the minimum so "Sí" and
  // "Sí sí podría" are treated as acceptance of the suggested down payment.
  const confirmsMinimumShortfall = policy.offlease
    && hasRealVehicle
    && Boolean(cashDown)
    && downPaymentRule.amount !== null
    && !downPaymentRule.meetsMinimum
    && predictorAskedMinimum
    && affirmativeDownConfirmation(latestInboundMessage);
  if (confirmsMinimumShortfall && downPaymentRule.minimum !== null) {
    down = /trade[- ]?in/i.test(down)
      ? `${downPaymentRule.minimum} + trade-in`
      : String(downPaymentRule.minimum);
    downPaymentRule = evaluateDownPayment(vehicle, down, {
      allowPromotionalThousand: policy.offlease && previousFinancing === 'yes',
    });
  }
  const normalizedTimeline = normalizeTimeline(firstNonEmpty(
    extractTimeline(messageForExtraction),
    extractTimeline(history),
    extractTimeline(memoryText(memory)),
    memoryValue(memory, ['timeline', 'purchase timeline', 'purchase_timeline']),
    input.purchase_timeline,
  ), language);
  const timeline = language === 'es' && normalizedTimeline === 'today' ? 'hoy' : normalizedTimeline;
  const memoryDocumentFacts = [
    memoryValue(memory, ['documents']),
    memoryValue(memory, ['identification', 'id', 'itin', 'passport', 'pasaporte'])
      ? `identification: ${memoryValue(memory, ['identification', 'id', 'itin', 'passport', 'pasaporte'])}`
      : EMPTY,
    memoryValue(memory, ['proof of income', 'income proof', 'prueba de ingresos', 'comprobante de ingresos'])
      ? `proof of income: ${memoryValue(memory, ['proof of income', 'income proof', 'prueba de ingresos', 'comprobante de ingresos'])}`
      : EMPTY,
  ].filter(Boolean).join('; ');
  const docs = mergeDocuments(firstNonEmpty(memoryDocumentFacts, input.documents), [rawHistory, rawMessage].filter(Boolean).join('\n'));
  const identification = firstNonEmpty(docs.id, memoryValue(memory, ['identification', 'id']), input.identification);
  const bankAccountRaw = firstNonEmpty(
    input.bank_account,
    conversationalEvidence(rawHistory, rawMessage).match(/(?:bank account|cuenta bancaria)[^;]*(?:yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available|no|not|sin|dont|don't|no tengo|i do not|do not have|not available)/i)?.[0],
    memoryValue(memory, ['bank account', 'bank_account']),
  );
  const bankAccount = yesNo(bankAccountRaw);
  const mergedMemory = mergeMemory(memory, {
    real_name: realName,
    vehicle,
    'down payment': down,
    previous_financing: previousFinancing,
    documents: docs.value,
    timeline,
  });

  const needsOffleaseMinimum = policy.offlease && hasRealVehicle && Boolean(down) && !downPaymentRule.meetsMinimum;

  const step: QualificationStep = (!policy.sourceAware || policy.requiresRealName) && !realName
    ? 'real_name'
    : !hasRealVehicle
      ? 'vehicle_type'
      : policy.requiresLocation && !customerLocation
        ? 'customer_location'
        : policy.sourceAware && !policy.phoneSatisfiedByNative && !chatPhone
          ? 'phone'
          : policy.offlease && (!down || needsOffleaseMinimum)
        ? 'down_payment'
        : 'complete';
  const questions: Record<CollectorLanguage, Record<QualificationStep, string>> = {
    en: {
      real_name: 'What is your full name?',
      vehicle_type: 'What vehicle are you looking for?',
      customer_location: 'What city are you located in?',
      phone: "What's the best phone number to reach you?",
      down_payment: 'How much do you have for the down payment?',
      purchase_timeline: 'When are you planning to buy?',
      documents: 'Do you have identification and proof of income?',
      bank_account: 'Do you have a bank account?',
      complete: EMPTY,
    },
    es: {
      real_name: '¿Cuál es tu nombre completo?',
      vehicle_type: '¿Qué vehículo estás buscando?',
      customer_location: '¿En qué ciudad te encuentras?',
      phone: '¿Cuál es el mejor número para contactarte?',
      down_payment: '¿Cuánto tienes para el enganche?',
      purchase_timeline: '¿Cuándo planeas comprar?',
      documents: '¿Tienes identificación y comprobante de ingresos?',
      bank_account: '¿Tienes una cuenta bancaria?',
      complete: EMPTY,
    },
  };
  const minimumQuestion = downPaymentRule.minimum
    ? language === 'es'
      ? `Para este vehículo requerimos un enganche mínimo de $${downPaymentRule.minimum}. ¿Con cuánto cuentas para el enganche?`
      : `This vehicle requires a minimum down payment of $${downPaymentRule.minimum}. How much do you have available?`
    : questions[language][step];
  const shortfallQuestion = language === 'es'
    ? `Te comento que el mínimo para este vehículo es de $${downPaymentRule.minimum}. ¿Crees que podrías conseguir un poco más?`
    : `The minimum for this vehicle is $${downPaymentRule.minimum}. Do you think you could bring a little more?`;
  const financingHistoryQuestion = language === 'es'
    ? 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?'
    : 'To apply for the $1000 down payment promotion, have you financed a vehicle before?';
  const repeatPreviousMinimumQuestion = step === 'down_payment'
    && policy.offlease
    && predictorAskedMinimum
    && !downPaymentRule.meetsMinimum
    && Boolean(clean(input.previous_predicted_bot_question));
  const nextQuestion = step === 'down_payment' && policy.offlease && downPaymentRule.amount === 1000 && previousFinancing === '' && !predictorAskedMinimum
    ? financingHistoryQuestion
    : repeatPreviousMinimumQuestion
      ? clean(input.previous_predicted_bot_question)
    : step === 'down_payment' && needsOffleaseMinimum
      ? shortfallQuestion
      : step === 'down_payment' && policy.offlease
        ? minimumQuestion
        : questions[language][step];
  const completedOrder: Array<[string, boolean]> = policy.sourceAware
    ? [
      ['real_name', Boolean(realName)],
      ['vehicle_type', hasRealVehicle],
      ['customer_location', Boolean(customerLocation)],
      ['phone', Boolean(chatPhone) || policy.phoneSatisfiedByNative],
      ...(policy.offlease ? [['down_payment', Boolean(down) && !needsOffleaseMinimum] as [string, boolean]] : []),
    ]
    : [
      ['real_name', Boolean(realName)],
      ['phone', Boolean(chatPhone)],
      ['vehicle_type', hasRealVehicle],
      ...(policy.offlease ? [['down_payment', Boolean(down) && !needsOffleaseMinimum] as [string, boolean]] : []),
    ];
  const lastAnsweredField = [...completedOrder].reverse().find(([, complete]) => complete)?.[0] ?? null;
  const qualificationProgress: QualificationProgress = {
    step,
    last_answered_field: step === 'complete' ? (policy.offlease ? 'down_payment' : 'phone') : lastAnsweredField,
    predicted_bot_question: nextQuestion,
    language,
    confidence: step === 'complete' ? 1 : 0.95,
    evidence: step === 'complete' ? 'complete' : 'normalized_fields',
  };
  const qualificationComplete = isQualificationComplete({
    real_name: realName,
    phone: chatPhone,
    vehicle_type: vehicle,
    down_payment: down,
    purchase_timeline: timeline,
    has_identification: docs.id,
    has_income_proof: docs.income,
    bank_account: bankAccount,
  })
    && (!policy.offlease || downPaymentRule.meetsMinimum)
    && (!policy.requiresLocation || Boolean(customerLocation))
    && (!policy.sourceAware || policy.phoneSatisfiedByNative || Boolean(chatPhone));
  const missingQualification = [
    !realName ? 'real_name' : EMPTY,
    !chatPhone && !policy.phoneSatisfiedByNative ? 'phone' : EMPTY,
    !hasRealVehicle ? 'vehicle_type' : EMPTY,
    policy.requiresLocation && !customerLocation ? 'customer_location' : EMPTY,
    policy.offlease
      ? (!down ? 'down_payment' : (!downPaymentRule.meetsMinimum ? 'down_payment_minimum' : EMPTY))
      : EMPTY,
  ].filter(Boolean);
  return {
    real_name: realName,
    vehicle_type: vehicle,
    customer_location: customerLocation,
    vehicle_category: downPaymentRule.category,
    required_down_payment: downPaymentRule.minimum,
    down_payment_amount: downPaymentRule.amount,
    down_payment_sufficient: downPaymentRule.meetsMinimum,
    down_payment: down,
    previous_financing: previousFinancing,
    purchase_timeline: timeline,
    documents: docs.value,
    identification,
    bank_account: bankAccount,
    qualification_memory: mergedMemory,
    has_identification: docs.id,
    has_income_proof: docs.income,
    next_question: nextQuestion,
    qualification_step: step,
    qualification_progress: qualificationProgress,
    qualification_complete: qualificationComplete,
    missing_qualification: missingQualification,
    qualification_source: qualificationSource,
    phone: chatPhone,
    chat_history_log: [clean(input.chat_history_log), clean(input.message)]
      .filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
      .join('\n'),
    dealeradmin_send_now: qualificationComplete && Boolean(chatPhone),
  };
}
