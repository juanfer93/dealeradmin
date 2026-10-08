import { EMPTY, RECENT_PHONE_EVIDENCE_DAYS } from './constants';
import { clean } from './text-cleaner';
import { firstNonEmpty, memoryValue } from './text-cleaner';
import { isVehicleStatement } from './vehicle-normalizer';
import type { CollectorInput } from './types';

// Accept spoken/grouped US numbers such as "704 699 07 61" while keeping
// the area code and exact 10/11-digit boundary checks that prevent prices,
// mileage, years, or IDs from becoming phone evidence.
const PHONE_PATTERN = /(?<!\d)(?:\+?1[\s().-]*)?(?:\([2-9]\d{2}\)|[2-9]\d{2})(?:[\s().-]*\d){7}(?!\d)/g;
const EXPLICIT_PHONE_LABEL_PATTERN = /(?:phone(?:\s*(?:number|#))?|mobile(?:\s*(?:phone|#))?|cell(?:ular)?(?:\s*(?:phone|#))?|telephone|tel(?:ephone)?|teléfono|telefono|celular|m[oó]vil|n[uú]mero\s+de\s+tel[eé]fono)\b/iu;

export function extractPhone(value: string | null | undefined): string {
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

export function extractExplicitPhone(value: string | null | undefined): string {
  const source = clean(value);
  const label = source.match(EXPLICIT_PHONE_LABEL_PATTERN);
  if (!label || label.index === undefined) return EMPTY;

  // OCR commonly puts the value on the next line, so inspect only the short
  // span immediately after the label. This prevents an ID/passport number
  // elsewhere in the document from being mistaken for the sender's phone.
  const afterLabel = source.slice(label.index + label[0].length, label.index + label[0].length + 80);
  return extractPhone(afterLabel);
}

export function extractRecentMessagePhone(
  messages: Array<{ body?: string | null; direction?: string | null; occurred_at?: string | Date | null; is_attachment_evidence?: boolean }>,
  referenceAt: Date,
  maxAgeDays = RECENT_PHONE_EVIDENCE_DAYS,
): string {
  const cutoff = referenceAt.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return messages
    .map((message) => ({
      body: String(message.body ?? ''),
      direction: String(message.direction ?? '').toLowerCase(),
      occurredAt: message.occurred_at ? new Date(message.occurred_at).getTime() : Number.NaN,
      isAttachmentEvidence: message.is_attachment_evidence === true,
    }))
    .filter((message) => message.direction === 'inbound' && Number.isFinite(message.occurredAt) && message.occurredAt >= cutoff && message.occurredAt <= referenceAt.getTime())
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .map((message) => message.isAttachmentEvidence ? extractExplicitPhone(message.body) : extractPhone(message.body))
    .find(Boolean) ?? EMPTY;
}

export function isPhoneOnlyLine(value: string): boolean {
  const source = clean(value);
  const digits = source.replace(/\D/g, '');
  return (digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))
    && !/[a-záéíóúüñ]/i.test(source);
}

export function isPhoneAreaCodeAmount(value: string, phone: string): boolean {
  const areaCode = phone.match(/^\+1(\d{3})/)?.[1] ?? EMPTY;
  return Boolean(areaCode && clean(value).replace(/\D/g, '') === areaCode);
}

const INVALID_REAL_NAMES = new Set([
  '.', '..', '...', 'unknown', 'n/a', 'na', 'lead', 'location', 'whatsapp', 'facebook',
  'saludos', 'hello', 'hi', 'hey', 'hola', 'ola', 'greetings', 'buenos dias', 'buenas tardes',
  'buenas noches', 'bendiciones', 'buenos dias bendiciones', 'buenas tardes bendiciones', 'buenas noches bendiciones',
  'thu chikitha linda',
  'información', 'informacion', 'más información', 'mas informacion', 'más info', 'mas info',
  'more information', 'more info', 'details', 'detalles',
]);
const BUSINESS_NAME_MARKERS = /\b(?:auto\s*sales|motors?|dealership|dealer|llc|inc(?:orporated)?|corp(?:oration)?|company|tatuajes?|tattoos?|operaciones?|operations?|transport(?:ation)?|logistics|construction|remodeling|roofing|realty|consulting|services?|servicios?|shop|tienda|salon|barbershop|restaurant)\b/i;
const QUALIFICATION_RESPONSE_MARKERS = /\b(?:today|hoy|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|now if possible|if possible now|ahora si se puede|si es posible ahora|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|siguiente semana|next month|pr[oó]ximo mes|siguiente mes|baltimore|maryland|where are you located|where are you|what|which|how|d[oó]nde est[aá]n ubicad[oa]s?|d[oó]nde est[aá]n|qué|que|ubicaci[oó]n|ubicados?|cu[aá]l(?:\s+ser[ií]a)?|ser[ií]a|gracias|thank you|thank|vehicle|car|auto|carro|coche|veh[ií]culo|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|requirements?|requisitos?|yes|yeah|yep|sim|correct|tengo|tiene|have it|i have|i'm looking|im looking|looking for|busco|buscando|quiero|want|interested|si|sí|no|no tengo|papeles?|cheques?|checks?|aplicar|apply|perfecto|perfect|claro|bien|bueno)\b/i;
const GENERIC_VEHICLE_INTENT = /\b(?:need|needs|looking\s+for|want|wants|seeking|shopping\s+for|trying\s+to\s+find|necesito|busco|buscando|quiero|me\s+interesa)\b[\s\S]*\b(?:vehicle|car|auto|carro|coche|veh[ií]culo|truck|suv|sedan|van|camioneta|pickup|pick-up)\b/i;
const INVENTORY_INTENT = /\b(?:inventory|inventario|see\s+(?:the\s+)?inventory|can\s+i\s+see|show\s+me|mu[eé]strame|ver\s+(?:el\s+)?inventario)\b/i;
const GREETING_ONLY = /^(?:buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|saludos|hello|hi|hey|hola|ola|greetings)(?:[,.!?\s]+bendiciones)?[,.!?\s]*$/i;
const SINGLE_WORD_NAME_BLOCKLIST = /^(?:ok(?:ay)?|si|s[ií]|sim|yes|no|yeah|yep|correct|cash|today|hoy|now|ahora|asap|inmediato|need|vehicle|car|auto|carro|coche|veh[ií]culo|requirements?|requisitos?|information|informaci[oó]n|details?|detalles?|location|baltimore|maryland|virginia|laurel|rosedale|sterling|elkton|manda|nada|bale|vale|ubicaci[oó]n|ubicasion|tacoma|toyota|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subaru|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion|mustang|rav4|civic|accord|camry|corolla|highlander|sienna|4runner|tundra|sequoia|prius|avalon|maverick|ranger|bronco|explorer|expedition|escape|edge|pilot|passport|ridgeline|odyssey|sierra|silverado|tahoe|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|range rover|defender|rlx|suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|financiar|finance|financing|down|payment|enganche|documents?|documentos?|identificaci[oó]n|income|ingresos|proof|prueba|phone|tel[eé]fono|number|n[uú]mero)$/i;
const NAME_DECLARATION = /(?:me llamo|mi nombre es|soy|yo soy|my name is|my name['’]s|i am|i['’]m|this is|call me(?!\s+at\b)|ll[aá]mame)\s+([a-záéíóúüñ][a-záéíóúüñ' -]{1,80})/i;
export const PHONE_LIKE_TEXT = /\b(?:mi|my)\s+(?:n[uú]mero|number|phone|tel[eé]fono|telephone|contact)\b/i;
const REAL_NAME_TOKEN = "[\\p{L}\\p{M}]+(?:[-'][\\p{L}\\p{M}]+)*";
const REAL_NAME_PATTERN = new RegExp(`^${REAL_NAME_TOKEN}(?:\\s+${REAL_NAME_TOKEN})*$`, 'u');
const NAME_SUFFIX_PUNCTUATION = /\b(jr|sr|ii|iii|iv|v)\.(?=\s|,|$)/gi;
const TECHNICAL_NAME_LABEL = /^(?:precio|price)\s+(?:de|of)\b/i;
const LOCATION_RESPONSE = /^(?:estoy|vivo)\s+en\b/i;
const NAME_PARTICLES = new Set(['da', 'de', 'del', 'der', 'di', 'la', 'las', 'los', 'van', 'von', 'y']);

function formatPersonalName(value: string): string {
  if (isLikelyBusinessName(value) || !REAL_NAME_PATTERN.test(value)) return value;
  return value.split(/\s+/).map((part, index) => {
    const lower = part.toLocaleLowerCase();
    if (index > 0 && NAME_PARTICLES.has(lower)) return lower;
    return lower.split(/([-'])/).map((piece) => /[-']/.test(piece) ? piece : piece ? `${piece[0].toLocaleUpperCase()}${piece.slice(1)}` : piece).join('');
  }).join(' ');
}

function normalizeNameSuffixPunctuation(value: string): string {
  return value.replace(NAME_SUFFIX_PUNCTUATION, '$1').replace(/,\s*$/, '').trim();
}

export function isValidRealName(value: string | null | undefined): boolean {
  const candidate = normalizeNameSuffixPunctuation(clean(value));
  if (!candidate || !REAL_NAME_PATTERN.test(candidate)) return false;
  return candidate.split(/\s+/).every((token) => token.toLocaleLowerCase() === 'y' || token.replace(/[-']/g, '').length >= 2);
}

export function isLikelyBusinessName(value: string | null | undefined): boolean {
  return BUSINESS_NAME_MARKERS.test(clean(value));
}

export function isLikelyProfileDisplayName(value: string | null | undefined): boolean {
  return NAME_DECLARATION.test(clean(value)) || !isValidRealName(value);
}

export function normalizeRealName(value: string | null | undefined): string {
  const candidate = normalizeNameSuffixPunctuation(clean(value));
  if (!candidate || INVALID_REAL_NAMES.has(candidate.toLowerCase())) return EMPTY;
  if (PHONE_LIKE_TEXT.test(candidate) || candidate.replace(/\D/g, '').length >= 7) return EMPTY;
  if (!isValidRealName(candidate)) return EMPTY;
  if (TECHNICAL_NAME_LABEL.test(candidate) || LOCATION_RESPONSE.test(candidate)) return EMPTY;
  if (SINGLE_WORD_NAME_BLOCKLIST.test(candidate)) return EMPTY;
  if (QUALIFICATION_RESPONSE_MARKERS.test(candidate) || GENERIC_VEHICLE_INTENT.test(candidate) || INVENTORY_INTENT.test(candidate) || GREETING_ONLY.test(candidate) || isVehicleStatement(candidate)) return EMPTY;
  if (candidate.length > 100 || candidate.split(/\s+/).length > 5) return EMPTY;
  return formatPersonalName(candidate);
}

const NON_CONVERSATIONAL_METADATA_LINE = /(?:\b(?:headline|source\s+url|attribution|ad\s*(?:id|name))\b|https?:\/\/|fb\.me\/|\.post\b)/i;

export function extractRealNameFromText(value: string): string {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter((line) => line && !NON_CONVERSATIONAL_METADATA_LINE.test(line));
  const segments = lines.flatMap((line) => line.split(/[.!?;]+/).map(clean).filter(Boolean));
  for (const segment of segments) {
    const explicit = segment.match(NAME_DECLARATION);
    const named = normalizeRealName(explicit?.[1]);
    if (named) return named;
    const candidate = segment.replace(/[.!?,;:]+$/g, '');
    const isTitleCasedToken = candidate[0] === candidate[0].toLocaleUpperCase() || candidate === candidate.toLocaleUpperCase();
    const isOneWordName = /^[a-záéíóúüñ][a-záéíóúüñ'-]{1,39}$/i.test(candidate) && isTitleCasedToken && !SINGLE_WORD_NAME_BLOCKLIST.test(candidate);
    const isFullName = /^[a-záéíóúüñ][a-záéíóúüñ'-]*(?:\s+[a-záéíóúüñ][a-záéíóúüñ'-]*){1,3}$/i.test(candidate);
    if (!isOneWordName && !isFullName) continue;
    const previousSegment = segments[segments.indexOf(segment) - 1] ?? EMPTY;
    const nextSegment = segments[segments.indexOf(segment) + 1] ?? EMPTY;
    if (isOneWordName && (/(?:^|\s)(?:no|not|manda|send|give)\s*$/i.test(previousSegment) || /^(?:una?|nada|vale|bale|ubicaci[oó]n)$/i.test(nextSegment))) continue;
    if (GENERIC_VEHICLE_INTENT.test(candidate) || /\b(?:quiero|busco|necesito|tengo|carro|auto|veh[ií]culo|suv|sedan|truck|troca|camioneta|pickup|van|financiar|finance|down|payment|hoy|today|yes|no)\b/i.test(candidate)) continue;
    const name = normalizeRealName(candidate);
    if (name) return name;
  }
  return EMPTY;
}

export function extractDeclaredRealNameFromText(value: string): string {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter((line) => line && !NON_CONVERSATIONAL_METADATA_LINE.test(line));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const explicit = normalizeRealName(line.match(NAME_DECLARATION)?.[1]);
    if (explicit) return explicit;
    if (!/(?:what(?:'s| is)?\s+(?:your|the)\s+name|full\s+name|what\s+should\s+i\s+call|cu[aá]l\s+es\s+tu\s+nombre|dime\s+tu\s+nombre)/i.test(line)) continue;
    const answer = normalizeRealName(lines[index + 1]);
    if (answer) return answer;
  }
  return EMPTY;
}

export function profileNameFromInput(input: CollectorInput, allowDecoratedProfileName = false): string {
  const candidate = firstNonEmpty(input.contact_name, input.contactName, input.profile?.name, input.name);
  if (!allowDecoratedProfileName) return isLikelyProfileDisplayName(candidate) ? EMPTY : normalizeRealName(candidate);
  if (!candidate || /[\p{N}]/u.test(candidate)) return EMPTY;
  const withoutDecoration = candidate.normalize('NFC').replace(/[\p{So}\p{Sk}\p{Cf}\uFE0F]/gu, '').replace(/\s+/g, ' ').trim();
  return isLikelyProfileDisplayName(withoutDecoration) ? EMPTY : normalizeRealName(withoutDecoration);
}

export function realNameFromQualificationMemory(memory: string | null | undefined): string {
  return normalizeRealName(memoryValue(memory ?? EMPTY, ['real_name', 'real name', 'customer_name', 'customer name', 'contact_name', 'contact name', 'full_name', 'full name', 'name', 'nombre_real', 'nombre real', 'nombre completo', 'nombre']));
}
