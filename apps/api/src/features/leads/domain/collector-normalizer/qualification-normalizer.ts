import { EMPTY } from './constants';
import { detectLeadLanguage } from './language-normalizer';
import type { CollectorLanguage } from './types';
import { clean, conversationalEvidence } from './text-cleaner';

const TIMELINE_MONTHS: Array<[string, string, string]> = [
  ['january', 'enero', 'jan(?:uary)?'],
  ['february', 'febrero', 'feb(?:ruary)?'],
  ['march', 'marzo', 'mar(?:ch)?'],
  ['april', 'abril', 'apr(?:il)?'],
  ['may', 'mayo', 'may'],
  ['june', 'junio', 'jun(?:e)?'],
  ['july', 'julio', 'jul(?:y)?'],
  ['august', 'agosto', 'aug(?:ust)?'],
  ['september', 'septiembre', 'sep(?:t(?:ember|iembre)?|tiembre)|setiembre'],
  ['october', 'octubre', 'oct(?:ober)?'],
  ['november', 'noviembre', 'nov(?:ember)?'],
  ['december', 'diciembre', 'dec(?:ember)?'],
];

function timelineMonth(value: string): [string, string] | null {
  const source = clean(value).toLowerCase();
  for (const [english, spanish, pattern] of TIMELINE_MONTHS) {
    if (new RegExp(`\\b(?:${pattern}|${spanish})\\b`, 'i').test(source)) return [english, spanish];
  }
  return null;
}

function timelineDate(value: string): string {
  const source = clean(value).toLowerCase();
  const spanish = source.match(/\b(0?[1-9]|[12]\d|3[01])\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i);
  if (spanish) return `${Number(spanish[1])} de ${spanish[2].replace(/^setiembre$/i, 'septiembre')}`;
  const english = source.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/i);
  if (english) return `${english[1].toLowerCase()} ${Number(english[2])}`;
  const englishDayFirst = source.match(/\b(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  if (englishDayFirst) return `${englishDayFirst[2].toLowerCase()} ${Number(englishDayFirst[1])}`;
  return EMPTY;
}

export function extractTimeline(message: string): string {
  const source = clean(message);
  if (!source) return EMPTY;
  const date = source.match(/\b(?:\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december))\b/i)?.[0];
  if (date) return timelineDate(date);
  const match = source.match(/\b(?:today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda|this week|esta semana|this month|este mes|esta mes|next week|pr[oó]xima? semana|siguiente semana|next month|pr[oó]ximo mes|siguiente mes|end of next month|a (?:fines?|finales?) del otro mes|a (?:fines?|finales?) del pr[oó]ximo mes|para (?:fines?|finales?) del (?:otro|pr[oó]ximo|siguiente) mes|within \d+ days?|en \d+ d[ií]as?|in \d+ (?:days?|weeks?|months?)|en \d+ (?:d[ií]as?|semanas?|mes(?:es)?)|in a month|en un mes|in two weeks|en dos semanas|jan(?:uary)?|enero|feb(?:ruary)?|febrero|mar(?:ch)?|marzo|apr(?:il)?|abril|may|mayo|jun(?:e)?|junio|jul(?:y)?|julio|aug(?:ust)?|agosto|sep(?:t(?:ember|iembre)?|tiembre)|setiembre|septiembre|oct(?:ober)?|octubre|nov(?:ember)?|noviembre|dec(?:ember)?|diciembre)\b/i)?.[0];
  return match ? normalizeTimeline(match) : /\b(?:solo|sólo|just|only)\b.*\b(?:mirar|mirando|ver|viendo|looking|browsing)\b/i.test(source) ? 'exploring options' : EMPTY;
}

export function normalizeTimeline(value: string, language: CollectorLanguage = detectLeadLanguage(value)): string {
  const source = clean(value).toLowerCase();
  if (!source) return EMPTY;
  const spanish = language === 'es';
  const localized = (english: string, spanishValue: string): string => spanish ? spanishValue : english;
  const date = timelineDate(source);
  if (date) return date;
  if (/\b(today|hoy|now if possible|if possible now|ahora si se puede|si es posible ahora|asap|as soon as possible|immediately|inmediato|para ya|ahora mismo|de inmediato|lo m[aá]s pronto posible|lo antes posible|lo antes que pueda)\b/i.test(source)) return 'today';
  if (/\b(this|esta)\s+(week|semana)\b/i.test(source)) return localized('this week', 'esta semana');
  if (/\b(this|este|esta)\s+(month|mes)\b/i.test(source)) return localized('this month', 'este mes');
  if (/\b(?:next|proxim[oa]|pr[oó]xim[oa]|siguiente)\s+(week|semana)\b/i.test(source)) return localized('next week', 'próxima semana');
  if (/\b(?:next|proxim[oa]|pr[oó]xim[oa]|siguiente)\s+(?:month|mes)\b|\bend of next month\b|\ba (?:fines?|finales?) del (?:otro|pr[oó]ximo|siguiente) mes\b|\bpara (?:fines?|finales?) del (?:otro|pr[oó]ximo|siguiente) mes\b/i.test(source)) return localized('next month', 'próximo mes');
  if (/\b(30|thirty)\s+days?\b/i.test(source)) return localized('within 30 days', 'en 30 días');
  if (/\b(?:in|en)\s+(?:a|un|one|uno|two|dos|\d+)\s+(?:days?|d[ií]as?|weeks?|semanas?|months?|mes(?:es)?)\b/i.test(source)) return clean(value).toLowerCase();
  const month = timelineMonth(source);
  if (month) {
    const englishMonth = TIMELINE_MONTHS.some(([english]) => new RegExp(`\\b${english}\\b`, 'i').test(source));
    return englishMonth ? month[0] : localized(month[0], month[1]);
  }
  if (/\b(?:exploring options|explorando opciones)\b/i.test(source) || /\b(solo|sólo|just|only)\b.*\b(mirar|mirando|ver|viendo|looking|browsing)\b/i.test(source)) return localized('exploring options', 'explorando opciones');
  return EMPTY;
}

export function yesNo(value: string): 'yes' | 'no' | '' {
  const source = clean(value).toLowerCase();
  if (!source) return '';
  if (/\b(no|n[oó]|dont|don't|no tengo|i do not|do not have|don't have|not available)\b/i.test(source)) return 'no';
  if (/\b(yes|sí|si|yeah|yep|correct|tengo|have it|i do|i have|available)\b/i.test(source)) return 'yes';
  return '';
}

export function mergeDocuments(current: string, message: string): { value: string; id: string; income: string } {
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
  if (id && !/\b(?:id|identification|identificación|license|licencia)\s*:/i.test(current) && !/\b(?:id|identification|identificación|license|licencia)\b/i.test(current)) parts.push(`identification: ${id}`);
  if (income && !/\b(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos)\s*:/i.test(current) && !/\b(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos)\b/i.test(current)) parts.push(`proof of income: ${income}`);
  return { value: [...new Set(parts.filter(Boolean))].join('; '), id, income };
}
