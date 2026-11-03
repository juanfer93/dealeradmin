import { CASH_DOWN_PAYMENT } from '../down-payment';
import { EMPTY } from './constants';
import { isPhoneOnlyLine } from './contact-normalizer';
import { clean, isEmptyMarker } from './text-cleaner';
import { VEHICLE_BRANDS, VEHICLE_CATEGORIES, VEHICLE_MODELS } from './vehicle-normalizer';
import { isCampaignButton, NO_DOWN_PAYMENT_RESPONSE, TRADE_IN_INTENT } from './collector-intents';

const AMOUNT_RANGE_TOKEN = '(?:\\d{1,3}(?:[,.]\\d{3})+|\\d+(?:[,.]\\d+)?\\s*(?:k|mil|thousand)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+(?:mil|thousand)(?:\\s+(?:quinientos|five hundred))?)';

function normalizeAmountRangeParts(start: string, end: string, assumeThousands = false): string {
  const unit = `${start} ${end}`.match(/\b(?:mil|thousand|k)\b/i)?.[0] ?? '';
  const applyContext = (value: string): string => {
    const trimmed = value.trim();
    if (unit && /^\d+(?:[.,]\d+)?$/.test(trimmed)) return `${trimmed} ${unit}`;
    if (assumeThousands && /^\d{1,2}(?:[.,]\d+)?$/.test(trimmed)) return `${trimmed} mil`;
    return trimmed;
  };
  const normalizedStart = normalizeAmount(applyContext(start));
  const normalizedEnd = normalizeAmount(applyContext(end));
  if (!/^\d+(?:\.\d+)?$/.test(normalizedStart) || !/^\d+(?:\.\d+)?$/.test(normalizedEnd)) return EMPTY;
  const values = [Number(normalizedStart), Number(normalizedEnd)].sort((left, right) => left - right);
  return `${values[0]} - ${values[1]}`;
}
export function normalizeAmount(value: string): string {
  const source = clean(value).toLowerCase();
  if (!source || isEmptyMarker(source)) return EMPTY;
  if (NO_DOWN_PAYMENT_RESPONSE.test(source)) return 'No down payment';
  const rangeMatch = source.match(new RegExp(`^\\$?(${AMOUNT_RANGE_TOKEN})(?:\\s*(mil|thousand|k))?\\s*(?:a|to|[-–—/])\\s*\\$?(${AMOUNT_RANGE_TOKEN})(?:\\s*(mil|thousand|k))?(?:\\s*(?:down|payment|enganche|inicial|d[oó]lares?|dollars?))?$`, 'i'));
  if (rangeMatch) {
    const start = `${rangeMatch[1]} ${rangeMatch[2] ?? EMPTY}`.trim();
    const end = `${rangeMatch[3]} ${rangeMatch[4] ?? EMPTY}`.trim();
    return normalizeAmountRangeParts(start, end);
  }
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
  const digits = source.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 15) return EMPTY;
  if (/\b(?:cash|contado|efectivo|paid in full|paga(?:r)? de contado)\b/i.test(source)) return CASH_DOWN_PAYMENT;

  const compact = source.replace(/\$/g, '').replace(/,/g, '').trim();
  if (!compact || /^[.]+$/.test(compact)) return EMPTY;
  const dottedThousands = compact.match(/^\d{1,3}(?:\.\d{3})+$/);
  if (dottedThousands) return String(Number(compact.replace(/\./g, '')));
  const kMatch = compact.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kMatch) return String(Math.round(Number(kMatch[1]) * 1000));
  const amountMatch = compact.match(/^(\d+(?:\.\d+)?)\s*(?:dollars?|d[oó]lar(?:es|e)?|usd)?$/i);
  if (amountMatch) return String(Math.round(Number(amountMatch[1])));
  const thousandMatch = source.match(/\b(\d{1,2})\s*(?:mil|thousand)\b/i);
  if (thousandMatch) return String(Number(thousandMatch[1]) * 1000);
  const words: Record<string, number> = {
    hundred: 100, thousand: 1000, mil: 1000, 'one thousand': 1000, 'a thousand': 1000, 'un mil': 1000,
    'mil quinientos': 1500, 'one thousand five hundred': 1500, 'dos mil': 2000, 'two thousand': 2000,
    'dos mil quinientos': 2500, 'two thousand five hundred': 2500, 'tres mil': 3000, 'three thousand': 3000,
    'tres mil quinientos': 3500, 'three thousand five hundred': 3500, 'cuatro mil': 4000, 'four thousand': 4000,
    'cinco mil': 5000, 'five thousand': 5000, 'seis mil': 6000, 'six thousand': 6000, 'siete mil': 7000,
    'seven thousand': 7000, 'ocho mil': 8000, 'eight thousand': 8000, 'nueve mil': 9000, 'nine thousand': 9000,
    'diez mil': 10000, 'ten thousand': 10000,
  };
  for (const [phrase, amount] of Object.entries(words).sort((left, right) => right[0].length - left[0].length)) {
    if (source.includes(phrase)) return String(amount);
  }
  return clean(value);
}

export function firstValidAmount(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = normalizeAmount(value ?? EMPTY);
    if (normalized) return normalized;
  }
  return EMPTY;
}

const AFFIRMATIVE_DOWN_CONFIRMATION = /^(?:yes|yeah|yep|correct|that's right|thats right|si|claro|correcto|okay|ok|bien|esta bien|seria bien|me parece bien|that works|works for me)(?:\s+(?:yes|yeah|yep|si|claro|correcto|okay|ok))*?(?:\s+(?:eso|that|works|for me))?$/i;
const REFERENCED_DOWN_CONFIRMATION = /^(?:(?:si|claro|correcto|ok(?:ay)?|bien)[,\s]+)?(?:con\s+(?:ese|este)\s+(?:monto|enganche|down)|con\s+(?:esa|esta)\s+cantidad|(?:ese|este)\s+(?:monto|enganche|down)|(?:esa|esta)\s+cantidad|con\s+eso|with\s+that\s+(?:amount|down)|that\s+(?:amount|down))(?:\s+(?:si|s[ií]\s+lo\s+tengo|s[ií]\s+puedo|esta\s+bien|est[aá]\s+bien|works?|is\s+(?:fine|okay|perfect)))?$/i;
const DOWN_CONTEXT_MARKERS = /\b(?:down|payment|enganche|pago\s+inicial|dinero|cash|contado|trade[- ]?in|tradein|m[ií]nimo|minimum|required|conseguir|bring|subir|subirle|raise|increase|m[aá]s|more)\b/i;
const NON_DOWN_AFFIRMATION_CONTEXT = /\b(?:phone|number|n[uú]mero|tel[eé]fono|document|documentos?|identificaci[oó]n|license|licencia|income|ingresos?|proof|prueba|bank|banco|cuenta|vehicle|veh[ií]culo|carro|auto|suv|sedan|truck|troca|van|hoy|today|semana|week|mes|month|ubicad|located|location)\b/i;
const CALL_TIME_QUESTION = /\b(?:a\s+qu[eé]\s+hora|qu[eé]\s+hora|what\s+time|best\s+time|time\s+to\s+(?:call|talk)|recibir\s+la\s+llamada|receive\s+the\s+call|llamada)\b/i;
const VEHICLE_YEAR_MIN = 2006;
const VEHICLE_YEAR_MAX = 2026;

function isVehicleYearValue(value: string): boolean {
  const normalized = value.replace(/[$,\s]/g, '');
  const year = Number(normalized);
  return /^\d{4}$/.test(normalized) && year >= VEHICLE_YEAR_MIN && year <= VEHICLE_YEAR_MAX;
}

export function isConcatenatedVehicleYearAmount(value: string, vehicleYear: number | null): boolean {
  if (vehicleYear === null) return false;
  const normalized = value.replace(/[$,\s]/g, '');
  const yearPrefix = Number(normalized.slice(0, 4));
  return /^\d{5,6}$/.test(normalized) && yearPrefix >= VEHICLE_YEAR_MIN && yearPrefix <= VEHICLE_YEAR_MAX;
}

function isVehicleYearRangeToken(value: string): boolean {
  const normalized = value.replace(/[$,\s]/g, '');
  const year = Number(normalized);
  return (/^\d{4}$/.test(normalized) && year >= VEHICLE_YEAR_MIN && year <= VEHICLE_YEAR_MAX)
    || /^(?:0[5-9]|1\d|2[0-6])$/.test(normalized);
}

function isShortVehicleYearValue(value: string): boolean {
  const normalized = value.replace(/[$,\s]/g, '');
  const year = Number(normalized);
  return /^(?:0[5-9]|1\d|2[0-6])$/.test(normalized) && Number.isInteger(year);
}

function isVehicleYearRange(value: string): boolean {
  const match = value.match(/\b(20\d{2}|0[5-9]|1\d|2[0-6])\s*(?:-|–|—|\/|a|to)\s*(20\d{2}|0[5-9]|1\d|2[0-6])\b/i);
  return Boolean(match && isVehicleYearRangeToken(match[1]) && isVehicleYearRangeToken(match[2]));
}

export function affirmativeDownConfirmation(value: string): boolean {
  const source = clean(value);
  if (!source || source.length > 120 || NON_DOWN_AFFIRMATION_CONTEXT.test(source)) return false;
  const compact = source.replace(/[.,!?¡¿-]+/g, ' ').replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (AFFIRMATIVE_DOWN_CONFIRMATION.test(compact) || REFERENCED_DOWN_CONFIRMATION.test(compact) || /^(?:bien|esta bien|seria bien|me parece bien|that works|works for me)(?=\s|$)/i.test(compact)) return true;
  return /^(?:yes|yeah|yep|si|claro|correcto|okay|ok|bien|esta bien|seria bien|me parece bien)(?=\s|$)(?:\s+(?:yes|yeah|yep|si|claro|correcto|okay|ok))*\s*(?:puedo|podria|can|could|i can|i could)\b(?:.*\b(?:subir(?:le|lo)?|raise|increase|more|mas|conseguir|get|bring|put)\b.*|\s*)$/i.test(compact);
}

export function extractQuestionedDownPayment(history: string): string {
  const questions = history.match(/[^?\n]*\?/g) ?? [];
  const lastQuestion = questions.at(-1) ?? EMPTY;
  if (!lastQuestion || !DOWN_CONTEXT_MARKERS.test(lastQuestion)) return EMPTY;
  const amountToken = '(?:\\d{1,3}(?:,\\d{3})+|\\d{1,2}\\s*(?:mil|thousand)|mil(?:\\s+quinientos)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+(?:mil|thousand)(?:\\s+(?:quinientos|five hundred))?|\\d+(?:[,.]\\d+)?\\s*k?)(?:\\s*d[oó]lar(?:es|e)?)?';
  const amount = lastQuestion.match(new RegExp(`(?:down|payment|enganche|inicial|deposit|dep[oó]sito|m[ií]nimo|minimum|required)[^?\\n]{0,80}?\\$?[ \\t]*(${amountToken})`, 'i'))?.[1]
    ?? lastQuestion.match(new RegExp(`\\$?[ \\t]*(${amountToken})[^?\\n]{0,80}?(?:down|payment|enganche|inicial|deposit|dep[oó]sito|m[ií]nimo|minimum|required)`, 'i'))?.[1]
    ?? (/(?:conseguir|bring|subir|raise|increase|m[aá]s|more)/i.test(lastQuestion) ? lastQuestion.match(new RegExp(`\\$?[ \\t]*(${amountToken})`, 'i'))?.[1] : undefined);
  return amount ? normalizeAmount(amount) : EMPTY;
}

export function extractTradeInDownPayment(message: string): string {
  const source = clean(message);
  if (!source || isCampaignButton(source)) return EMPTY;
  const tradeIn = TRADE_IN_INTENT.test(source);
  const amountPattern = '(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?|\\d{1,2}\\s*(?:mil|thousand)|mil(?:\\s+quinientos)?|(?:un|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+mil(?:\\s+(?:quinientos|five hundred))?)';
  const tradeInPattern = '(?:trade[- ]?in|my car|my vehicle|my van|my truck|mi carro|mi auto|mi vehículo|mi van|mi troca|mi camioneta|carro como enganche|(?:cambiar|cambio)\\s+(?:(?:mi|el|de)\\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)|change\\s+(?:my\\s+)?(?:vehicle|car|van|truck))';
  const beforeTradeIn = source.match(new RegExp(`\\$?\\s*(${amountPattern})\\s*(?:down|payment|enganche|inicial)?\\s*(?:\\+|and|y)\\s*${tradeInPattern}`, 'i'));
  const afterTradeIn = source.match(new RegExp(`${tradeInPattern}\\s*(?:(?:and|plus|with|y|mas|más|con)\\s*(?:put|poner|pay|pagar|give|dar)?\\s*|[^0-9;.!?]{0,16}(?:down|payment|enganche|inicial|deposit|dep[oó]sito)[^0-9;.!?]{0,8})\\$?\\s*(${amountPattern})`, 'i'));
  const amount = beforeTradeIn?.[1] ?? afterTradeIn?.[1];
  const normalized = amount ? normalizeAmount(amount) : EMPTY;
  return normalized ? `${normalized} + trade-in` : tradeIn ? 'trade-in' : EMPTY;
}

export function extractDownPayment(message: string): string {
  const source = String(message ?? '').replace(/\r\n?/g, '\n').replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ').trim();
  if (!source || isCampaignButton(source)) return EMPTY;
  if (NO_DOWN_PAYMENT_RESPONSE.test(source)) return 'No down payment';
  const cashEvidenceSource = source.replace(/(?:bank account|cuenta bancaria|cuenta de banco|cheque|check)[^.!?\n]*(?:[.!?]|$)/gi, '');
  if (/\b(?:pay|pagar|pago|pagar[eé]|voy\s+a\s+pagar|purchase|buy|comprar|compra|hacer\s+la\s+compra|put|poner|down|enganche|inicial)[^.!?\n]{0,80}\b(?:cash|contado|efectivo|paid\s+in\s+full|paga(?:r)?\s+de\s+contado)\b/i.test(cashEvidenceSource)) return CASH_DOWN_PAYMENT;
  const amountToken = '(?:\\d{1,3}(?:,\\d{3})+|\\d{1,2}\\s*(?:mil|thousand)|mil(?:\\s+quinientos)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\\s+(?:mil|thousand)(?:\\s+(?:quinientos|five hundred))?|\\d+(?:[,.]\\d+)?\\s*k?)(?:\\s*d[oó]lar(?:es|e)?)?';
  const safeSource = source.split('\n').filter((line) => !isPhoneOnlyLine(line)).join('\n');
  const informalAmount = safeSource.match(new RegExp(`(?:tanda|cantidad|lo m[aá]ximo|lo m[aá]s que tengo|maximum|maximo|m[aá]ximo)[^\\n]{0,60}?\\$?(${amountToken})`, 'i'))?.[1];
  const contextualPromptLine = safeSource.split('\n').map((line, index, lines) => line.trim() === '__DOWN_PROMPT__' ? lines[index + 1]?.trim() ?? EMPTY : EMPTY).find(Boolean) ?? EMPTY;
  const contextualPromptAmount = contextualPromptLine.match(new RegExp(`^(?:(?:quiz[aá]s|maybe|perhaps|aprox(?:imadamente)?|approximately|around|unos?)\\s+)?\\$?(${amountToken})\\b`, 'i'))?.[1];
  const rangeMatch = safeSource.match(new RegExp(`\\$?(${amountToken})(?:\\s*(mil|thousand|k))?\\s*(?:a|to|[-–—/])\\s*\\$?(${amountToken})(?:\\s*(mil|thousand|k))?`, 'i'));
  if (rangeMatch) {
    const start = `${rangeMatch[1]} ${rangeMatch[2] ?? EMPTY}`.trim();
    const end = `${rangeMatch[3]} ${rangeMatch[4] ?? EMPTY}`.trim();
    if (isVehicleYearValue(start) || isVehicleYearValue(end)) return EMPTY;
    const assumeThousands = /\b(?:down|payment|enganche|inicial|deposit|dep[oó]sito)\b/i.test(source) && [start, end].every((value) => /^\d{1,2}$/.test(value.trim()));
    const normalizedRange = normalizeAmountRangeParts(start, end, assumeThousands);
    if (normalizedRange) return normalizedRange;
  }
  const amount = source.match(new RegExp(`(?:down|enganche|inicial|deposit|dep[oó]sito)[ \\t]*(?:payment|pago)?[ \\t]*(?:is|es|de|:)?[ \\t]*\\$?[ \\t]*(${amountToken})`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:at least|minimum of)\\s+\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\$?[ \\t]*(${amountToken})[ \\t]*(?:(?:for|para|as|on|de|del)[ \\t]*(?:el|la|the)?[ \\t]*)?(?:down|enganche|inicial)`, 'i'))?.[1]
    ?? source.match(new RegExp(`(?:^|\\n)\\s*\\$?(${amountToken})\\b[^\\n]{0,100}\\b(?:down|payment|pago(?:\\s+inicial)?|enganche|inicial)\\b`, 'i'))?.[1]
    ?? contextualPromptAmount
    ?? source.match(new RegExp(`\\b(?:tengo|have|i have|i can put|puedo poner)[ \\t]+(?:down[ \\t]+)?(?:a[ \\t]+)?\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:doy|dar(?:e|é|ia|ía)?|pongo|poner|i(?:'|’)ll put|i put)[ \\t]+(?:down[ \\t]+)?(?:los|las|el|la|unos|unas|un|una)?[ \\t]*(?:at least[ \\t]+|de[ \\t]+|para[ \\t]+)?\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:cuento|cuenta)[ \\t.,;:]+con[ \\t.,;:]*\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:cuento|cuenta)\\b[^\\n]{0,80}?(?:y|and|plus)[ \\t.,;:]*\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:puedo|puede|can|could|i can|i could)[ \\t]+(?:con|with)[ \\t]+\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`(?:^|\\n)\\s*con[ \\t]+\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? informalAmount
    ?? source.match(new RegExp(`(?:^|\\n)\\$?[ \\t]*(${amountToken})[ \\t]*(?:d[oó]lares?|usd)?[ \\t]*(?:est[aá]\\s+(?:perfecto|bien)|perfecto|bien|ok(?:ay)?|works?(?:\\s+for\\s+me)?|is\\s+(?:fine|perfect|okay))\\b`, 'i'))?.[1];
  if (amount && isShortVehicleYearValue(amount) && (VEHICLE_BRANDS.test(source) || VEHICLE_MODELS.test(source) || VEHICLE_CATEGORIES.test(source))) return EMPTY;
  return amount ? normalizeAmount(amount) : EMPTY;
}

export function extractStandaloneDownPayment(message: string): string {
  const source = String(message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source || isCampaignButton(source)) return EMPTY;
  if (NO_DOWN_PAYMENT_RESPONSE.test(source)) return 'No down payment';
  const safeSource = source.split('\n').filter((line) => !isPhoneOnlyLine(line)).join('\n');
  const matches = [...safeSource.matchAll(/(?:^|\n)\$?[ \t]*(\d{1,3}(?:[,.]\d{3})+|\d+(?:[,.]\d+)?\s*k?|\d{1,2}\s*(?:mil|thousand)|mil(?:\s+quinientos)?|(?:un|one|a|dos|two|tres|three|cuatro|four|cinco|five|seis|six|seven|ocho|eight|nueve|nine|diez|ten)\s+(?:mil|thousand)(?:\s+(?:quinientos|five hundred))?)[ \t]*\$?[ \t]*(?:(?:tengo|have|available|disponible|i have|i can put)[ \t]*\d{0,2})?[ \t]*\.?[ \t]*(?=\n|$)/gim)];
  const standalone = matches.reverse().find((match) => !isVehicleYearValue(match[1]) && !isShortVehicleYearValue(match[1]));
  return standalone ? normalizeAmount(standalone[1]) : EMPTY;
}

export function extractLatestDownPayment(message: string): string {
  const lines = String(message ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map((line) => clean(line).replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ')).filter(Boolean).reverse();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const previousDistinctLine = lines.slice(lineIndex + 1).find((candidate) => candidate !== line) ?? '';
    if (/^\d{1,2}$/.test(line) && CALL_TIME_QUESTION.test(previousDistinctLine)) continue;
    const lineDigits = line.replace(/\D/g, '');
    const paymentRange = /\$?\d+(?:[,.]\d+)?\s*(?:a|to|[-–/])\s*\$?\d+(?:[,.]\d+)?/i.test(line);
    if (/[?¿]/.test(line) || isPhoneOnlyLine(line) || isVehicleYearRange(line) || /\b(?:phone|telephone|tel[eé]fono|n[uú]mero|number)\b/i.test(line) || (lineDigits.length >= 7 && !paymentRange && !/\b(?:down|payment|enganche|inicial|deposit|dep[oó]sito)\b/i.test(line))) continue;
    const contextual = extractDownPayment(line);
    if (contextual && !(isShortVehicleYearValue(contextual) && (VEHICLE_BRANDS.test(String(message)) || VEHICLE_MODELS.test(String(message)) || VEHICLE_CATEGORIES.test(String(message))))) return contextual;
    const standalone = extractStandaloneDownPayment(line);
    if (standalone && !isShortVehicleYearValue(standalone)) return standalone;
    if (/\b\d{1,2}:\d{2}\b|\b(?:am|pm)\b/i.test(line)) continue;
    const amountToken = '(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[,.]\\d+)?\\s*k?)';
    const range = [...line.matchAll(new RegExp(`\\$?(${amountToken})\\s*(?:a|to|[-–/])\\s*\\$?(${amountToken})`, 'gi'))]
      .map((match) => normalizeAmountRangeParts(match[1], match[2], /\b(?:down|payment|enganche|inicial|deposit|dep[oó]sito)\b/i.test(line)))
      .find((amount) => amount && !isVehicleYearRange(amount));
    if (range) return range;
    const answerLike = /\b(?:tengo|have|cuento|cuenta|puedo|podr[ií]a|maximum|maximo|m[aá]ximo|son|available|will\s+have|down|payment|enganche|d[oó]lares?|dollars?)\b/i.test(line) || /^(?:si|sí|yes|yeah|yep|claro|ok(?:ay)?|bien)\b\s*\$?\d/i.test(line);
    if (!answerLike) continue;
    const hasVehicleEvidence = VEHICLE_BRANDS.test(String(message)) || VEHICLE_MODELS.test(String(message)) || VEHICLE_CATEGORIES.test(String(message));
    const amounts = [...line.matchAll(new RegExp(`\\$?(${amountToken})(?!\\d)`, 'gi'))]
      .map((match) => normalizeAmount(match[1]))
      .filter((amount) => amount && !isVehicleYearValue(amount) && !(hasVehicleEvidence && isShortVehicleYearValue(amount)));
    if (amounts.length > 0) return amounts.at(-1) ?? EMPTY;
  }
  return EMPTY;
}
