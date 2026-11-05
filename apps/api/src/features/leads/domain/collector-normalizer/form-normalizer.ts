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

function normalizedLine(value: string): string {
  return clean(value).replace(/^\*+|\*+$/g, '').trim();
}

function lineValue(lines: string[], labels: RegExp): string {
  for (const line of lines) {
    const match = normalizedLine(line).match(labels);
    if (match?.[1]) return clean(match[1]);
  }
  return '';
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
  // Reconciliation intentionally compacts each stored message before
  // rebuilding the transcript. Recreate boundaries before parsing so a
  // compacted form is equivalent to the original multi-line payload.
  const formLines = source.replace(/\s+(?=(?:\*{0,2}(?:headline|source\s+url|phone\s+number|full\s+name)\s*:|[¿?](?:prefieres|en\s+qu[eé]|cu[aá]nto|cu[aá]ndo|hay\s+alg[uú]n)\b))/gi, '\n');
  const lines = formLines.split('\n').map(clean).filter(Boolean);
  const fullNameValue = lineValue(lines, /^\s*(?:\*+)?(?:full\s+name|nombre\s+completo)\s*:\s*(.*?)\s*(?:\*+)?$/i);
  const fullName = normalizeRealName(fullNameValue) || fullNameValue;
  const context: LeadFormContext = {
    headline: lineValue(lines, /^\s*(?:\*+)?headline\s*:\s*(.*?)\s*(?:\*+)?$/i),
    source_url: lineValue(lines, /^\s*(?:\*+)?source\s+url\s*:\s*(.*?)\s*(?:\*+)?$/i),
    phone: formPhone(lineValue(lines, /^\s*(?:phone\s+number|n[uú]mero\s+de\s+tel[eé]fono)\s*:\s*(.*?)\s*(?:\*+)?$/i)),
    financing_preference: lineValue(lines, /(?:prefieres\s+pagar\s+de\s+contado\s+o\s+financiar|cash\s+or\s+finance)\??\s*:\s*(.*?)\s*$/i),
    credit_score_range: lineValue(lines, /(?:puntaje\s+de\s+cr[eé]dito|credit\s+score\s+range)\??\s*:\s*(.*?)\s*$/i),
    down_payment_preference: lineValue(lines, /(?:planeas\s+dar\s+de\s+enganche|down\s+payment)\??\s*:\s*(.*?)\s*$/i),
    full_name: fullName,
    purchase_timeline: lineValue(lines, /(?:planeas\s+comprar\s+tu\s+pr[oó]ximo\s+veh[ií]culo|purchase\s+timeline)\??\s*:\s*(.*?)\s*$/i),
    contact_preference: lineValue(lines, /(?:prefieres\s+que\s+te\s+contactemos\s+por\s+llamada\s+o\s+mensaje\s+de\s+texto|contact\s+preference)\??\s*:\s*(.*?)\s*$/i),
    vehicle: lineValue(lines, /(?:hay\s+alg[uú]n\s+tipo\s+de\s+veh[ií]culo\s+que\s+te\s+interese|vehicle\s+of\s+interest)\??\s*:\s*(.*?)\s*$/i),
  };
  return Object.values(context).some(Boolean) ? context : null;
}
