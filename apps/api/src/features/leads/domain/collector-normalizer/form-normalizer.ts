import { extractPhone, normalizeRealName } from './contact-normalizer';
import { clean } from './text-cleaner';

export type LeadFormContext = {
  headline: string;
  source_url: string;
  phone: string;
  financing_preference: string;
  credit_score_range: string;
  down_payment_preference: string;
  full_name: string;
  purchase_timeline: string;
  contact_preference: string;
  vehicle: string;
};

const FORM_MARKER = /(?:\bheadline\s*:|\bsource\s+url\s*:|filled\s+out\s+your\s+form|complet[eé]\s+el\s+formulario)/i;

// The form can arrive as a normal multiline message or as one compacted
// reconciliation string. Keep every known label as a hard parsing boundary.
const FORM_FIELD_LABELS = [
  '\\*{0,2}headline',
  '\\*{0,2}source\\s+url',
  'phone\\s+number',
  'n[uú]mero\\s+de\\s+tel[eé]fono',
  '(?:¿\\s*)?prefieres\\s+pagar\\s+de\\s+contado\\s+o\\s+financiar\\??',
  'cash\\s+or\\s+finance',
  '(?:¿\\s*)?en\\s+qu[eé](?:\\s+rango)?\\s+se\\s+encuentra\\s+tu\\s+puntaje\\s+de\\s+cr[eé]dito\\??',
  'credit\\s+score\\s+range',
  '(?:¿\\s*)?cu[aá]nto\\s+planeas\\s+dar\\s+de\\s+enganche\\??',
  'down\\s+payment',
  '(?:¿\\s*)?full\\s+name',
  'nombre\\s+completo',
  '(?:¿\\s*)?cu[aá]ndo\\s+planeas\\s+comprar\\s+tu\\s+pr[oó]ximo\\s+veh[ií]culo\\??',
  'purchase\\s+timeline',
  '(?:¿\\s*)?prefieres\\s+que\\s+te\\s+contactemos\\s+por\\s+llamada\\s+o\\s+mensaje\\s+de\\s+texto\\??',
  'contact\\s+preference',
  '(?:¿\\s*)?hay\\s+alg[uú]n\\s+tipo\\s+de\\s+veh[ií]culo\\s+que\\s+te\\s+interese\\??',
  'vehicle\\s+of\\s+interest',
].join('|');

function normalizedValue(value: string): string {
  return clean(value).replace(/^\*+\s*|\s*\*+$/g, '').trim();
}

function fieldValue(source: string, label: string): string {
  const match = source.match(new RegExp(`${label}\\s*:\\s*(.*?)(?=\\s*(?:${FORM_FIELD_LABELS})\\s*:|\\s*Inbox\\s+URL\\s*:|\\s*\\n|\\s*(?:hello|¡?hola)[!,]?\\s|$)`, 'i'));
  return normalizedValue(match?.[1] ?? '');
}

function formPhone(value: string): string {
  return extractPhone(value);
}

/**
 * Extracts structured lead-form facts without changing ordinary conversation
 * interpretation. The current CarHub workflow delivers the form as an
 * inbound message, sometimes twice (Messenger and WhatsApp), so the parser
 * deliberately accepts either language and keeps the facts additive.
 */
export function extractLeadFormContext(value: string | null | undefined): LeadFormContext | null {
  const source = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || !FORM_MARKER.test(source)) return null;
  // Reconciliation may compact stored messages into one line. Parsing against
  // label boundaries makes compact and multiline payloads equivalent.
  const compactSource = source.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
  const fullNameValue = fieldValue(compactSource, '(?:\\*{0,2}full\\s+name|nombre\\s+completo)');
  const fullName = normalizeRealName(fullNameValue) || fullNameValue;
  const context: LeadFormContext = {
    headline: fieldValue(compactSource, '\\*{0,2}headline'),
    source_url: fieldValue(compactSource, '\\*{0,2}source\\s+url'),
    phone: formPhone(fieldValue(compactSource, '(?:phone\\s+number|n[uú]mero\\s+de\\s+tel[eé]fono)')),
    financing_preference: fieldValue(compactSource, '(?:prefieres\\s+pagar\\s+de\\s+contado\\s+o\\s+financiar\\??|cash\\s+or\\s+finance)'),
    credit_score_range: fieldValue(compactSource, '(?:en\\s+qu[eé](?:\\s+rango)?\\s+se\\s+encuentra\\s+tu\\s+puntaje\\s+de\\s+cr[eé]dito\\??|credit\\s+score\\s+range)'),
    down_payment_preference: fieldValue(compactSource, '(?:cu[aá]nto\\s+planeas\\s+dar\\s+de\\s+enganche\\??|down\\s+payment)'),
    full_name: fullName,
    purchase_timeline: fieldValue(compactSource, '(?:cu[aá]ndo\\s+planeas\\s+comprar\\s+tu\\s+pr[oó]ximo\\s+veh[ií]culo\\??|purchase\\s+timeline)'),
    contact_preference: fieldValue(compactSource, '(?:prefieres\\s+que\\s+te\\s+contactemos\\s+por\\s+llamada\\s+o\\s+mensaje\\s+de\\s+texto\\??|contact\\s+preference)'),
    vehicle: fieldValue(compactSource, '(?:hay\\s+alg[uú]n\\s+tipo\\s+de\\s+veh[ií]culo\\s+que\\s+te\\s+interese\\??|vehicle\\s+of\\s+interest)'),
  };
  return Object.values(context).some(Boolean) ? context : null;
}
