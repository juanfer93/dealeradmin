import { CASH_DOWN_PAYMENT, evaluateDownPayment } from '../down-payment';
import { ADVISOR_HANDOFF_VEHICLE, EMPTY } from './constants';
import { extractPhone, extractRealNameFromText, extractDeclaredRealNameFromText, isLikelyBusinessName, isLikelyProfileDisplayName, isPhoneAreaCodeAmount, isPhoneOnlyLine, normalizeRealName, PHONE_LIKE_TEXT, profileNameFromInput, realNameFromQualificationMemory } from './contact-normalizer';
import { detectLeadLanguage } from './language-normalizer';
import { collectorFlowPolicy, effectiveChannel, extractCustomerLocation, isAdvisorHandoffVehicle, isMessengerChannel, isWhatsAppChannel } from './flow-policy';
import { clean, conversationalEvidence, firstNonEmpty, isEmptyMarker, lastMeaningfulLine, memoryText, memoryValue } from './text-cleaner';
import type { CollectorFlowPolicy, CollectorInput, CollectorLanguage, CollectorOutput, QualificationProgress, QualificationStep } from './types';
import { VEHICLE_BRANDS, VEHICLE_CATEGORIES, VEHICLE_CONTEXT, VEHICLE_MODELS, extractExplicitVehicleTrim, extractVehicleLabel, extractVehicleYear, normalizeVehicle } from './vehicle-normalizer';
import { extractTimeline, mergeDocuments, normalizeTimeline, yesNo } from './qualification-normalizer';
import { mergeMemory, normalizeMemoryDownPayment } from './qualification-memory';
import { resolveVehicleCandidate, type VehicleCandidate } from './candidate-resolver';
import { isQualificationComplete, missingQualification as getMissingQualification, qualificationStep } from './reconciliation';
export { hasMinimumRoutingQualification, isQualificationComplete } from './reconciliation';

export type { CollectorInput, CollectorLanguage, CollectorOutput, QualificationProgress, QualificationStep } from './types';
export { ADVISOR_HANDOFF_VEHICLE } from './constants';
export { RECENT_PHONE_EVIDENCE_DAYS } from './constants';
export { extractRecentMessagePhone } from './contact-normalizer';
export { isValidRealName, normalizeRealName, realNameFromQualificationMemory } from './contact-normalizer';
export { detectLeadLanguage } from './language-normalizer';
export { isAdvisorHandoffVehicle } from './flow-policy';

const ECONOMIC_SEDAN_INTENT = /\b(?:carro|auto|coche|veh[ií]culo|algo)\s+econ[oó]mic[oa]s?\b/i;
const GENERIC_SEDAN_INTENT = /\b(?:small|compact|affordable|budget|economical)\s+(?:car|auto|coche|carro|vehicle)\b|\b(?:carro|auto|coche|veh[ií]culo)[\s\W_]{1,8}(?:pequeñ[oa]|pequen[oa]|peken[oa]|chic[oa])\b/i;
const FAMILY_PASSENGER_VAN_INTENT = /\b(?:algo\s+)?familiar\b[\s\S]{0,80}\bpasajeros?\b/i;
const NO_DOWN_PAYMENT_RESPONSE = /\b(?:no(?:\s+\w+){0,3}\s+(?:down(?:\s+payment)?|enganche|pago\s+inicial|dinero)|sin\s+(?:down|enganche|pago\s+inicial)|zero\s+down|\$?0\s*(?:down|enganche|pago\s+inicial)|no\s+(?:cuento|cuenta)\s+con\s+(?:dinero|down|enganche|pago\s+inicial))\b/i;
const TRADE_IN_INTENT = /\btrade[- ]?in\b|\b(?:carro|auto|veh[ií]culo)\s+como\s+enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\bchange\s+(?:my\s+)?(?:vehicle|car|van|truck)\b|\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\b(?:and|y)\s+(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\s+(?:for|para)\s+(?:trade(?:[- ]?in)?|entregar|cambiar|dar)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b[\s\S]{0,24}\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b|\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b[\s\S]{0,24}\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b/i;
const NON_VEHICLE_INTENT_VALUES = /^(?:(?:(?:quiero|necesito|me gustar[ií]a|me interesa)\s+)?(?:m[aá]s\s+)?(?:informaci[oó]n|info|detalles?|details?|information)|more\s+(?:information|info|details?)|learn\s+more)$/i;

const PREVIOUS_FINANCING_QUESTION = /\b(?:has\s+financiado|han?\s+financiado|have\s+you\s+financed|did\s+you\s+finance|financ(?:ed|ing)\s+before|financiamiento\s+(?:de autos?|de un veh[ií]culo)|(?:ya|antes|anteriormente|previously|before)[^?\n]{0,80}(?:financ(?:e|ed|ing)|financiad[oa]))\b/i;
const PREVIOUS_FINANCING_YES = /(?:ya\s+he\s+financiad[oa]|he\s+financiad[oa]\s+antes|financi[eé]\s+antes|(?:ya|anteriormente)\s+financi[eé](?=\s|$|[,.;!?])|i\s+have\s+financed\s+before|i\s+financed\s+(?:a|an|the)\s+(?:vehicle|car)|financed\s+before|previous(?:ly)?\s+financ(?:ed|ing))/i;
const PREVIOUS_FINANCING_NO = /^(?:no(?=[\s,.;!?]|$)|nope|nah|nunca|jam[aá]s|never|not\s+before|no\s+(?:he\s+)?financiad[oa]|no\s+tengo\s+(?:historial|experiencia|financiamiento))/i;
const PREVIOUS_FINANCING_AFFIRMATIVE = /^(?:yes|yeah|yep|si|sí|sim|claro|correcto|tengo|have it|i do|i have|i can|i could|could|can|puedo|podr[ií]a|es posible|possible|con (?:este|ese) monto|(?:este|ese) monto|con (?:esta|esa) cantidad|(?:esta|esa) cantidad)(?=[\s,.;!?]|$)/i;

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

function firstValidAmount(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = normalizeAmount(value ?? EMPTY);
    if (normalized) return normalized;
  }
  return EMPTY;
}

function extractVehicle(message: string): string {
  const source = String(message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return EMPTY;
  const lines = source.split(/\n+/).map(clean).filter(Boolean);
  const candidates: VehicleCandidate[] = [];
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
    const category = withoutOtherFacts.match(/\b(suv|sedan|truck|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión)\b/i)?.[1];
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
        isColloquialTruck: /\b(?:troca|trokita|troquita|troque|trokas|camionetq)\b/i.test(candidate),
      });
    }
  }
  // A buyer can change the vehicle during the same conversation. The last
  // explicit vehicle answer is the active choice, so the down payment must be
  // evaluated against that answer rather than an earlier, more specific model.
  const latest = resolveVehicleCandidate(candidates);
  // Whisper often produces a standalone colloquial truck token after the
  // requested model. Preserve that more specific model when it is clearly
  // the same answer sequence; an explicit later Sedan/SUV/etc. still wins.
  const best = latest;
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
    ?? source.match(new RegExp(`\\b(?:doy|dar[eé]?|pongo|poner|i(?:'|’)ll put|i put)[ \\t]+(?:down[ \\t]+)?(?:at least[ \\t]+|de[ \\t]+|para[ \\t]+)?\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:cuento|cuenta)[ \\t.,;:]+con[ \\t.,;:]*\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:cuento|cuenta)\\b[^\\n]{0,80}?(?:y|and|plus)[ \\t.,;:]*\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`\\b(?:puedo|puede|can|could|i can|i could)[ \\t]+(?:con|with)[ \\t]+\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
    ?? source.match(new RegExp(`(?:^|\\n)\\s*con[ \\t]+\\$?[ \\t]*(${amountToken})\\b`, 'i'))?.[1]
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
  const standalone = matches.reverse().find((match) => !/^20(?:1\d|2[0-6])$/.test(match[1].replace(/[$,\s]/g, '')));
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
      || (lineDigits.length >= 7 && !paymentRange && !/\b(?:down|payment|enganche|inicial|deposit|dep[oó]sito)\b/i.test(line))) continue;
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
  const historyForExtraction = stripCampaignButtonPhrases(rawHistory);
  const channel = effectiveChannel(input);
  const suppliedName = normalizeRealName(input.real_name);
  const profileName = profileNameFromInput(input, isMessengerChannel(channel));
  const extractedNames = [
    realNameFromQualificationMemory(memory),
    extractRealNameFromText(rawMessage),
    extractRealNameFromText(rawHistory),
  ];
  const whatsappNames = [
    extractRealNameFromText(rawMessage),
    extractRealNameFromText(rawHistory),
    profileName,
    realNameFromQualificationMemory(memory),
  ];
  const messengerTextName = [
    extractDeclaredRealNameFromText(rawMessage),
    extractDeclaredRealNameFromText(rawHistory),
    ...extractedNames,
  ].map(normalizeRealName).find(Boolean) ?? EMPTY;
  // A fresh Messenger profile name must be allowed to repair a contaminated
  // snapshot (for example "Me Pagan Cheque" from a prior answer).
  const messengerProfileName = profileName || suppliedName;
  const realName = isMessengerChannel(channel)
    // A valid contact/profile name is authoritative. Message text may replace
    // only a business/technical label, or answer an explicit name prompt.
    ? (messengerProfileName && !isLikelyBusinessName(messengerProfileName)
      ? messengerProfileName
      : messengerTextName || messengerProfileName)
    : isWhatsAppChannel(channel)
      // WhatsApp gets a declared chat name first, then the profile name. The
      // message body and profile are separate fields in the webhook contract.
      ? whatsappNames.map(normalizeRealName).find(Boolean) ?? EMPTY
      : (isLikelyBusinessName(suppliedName) || isLikelyProfileDisplayName(suppliedName)
        ? [...extractedNames, suppliedName]
        : [suppliedName, ...extractedNames]
      ).map(normalizeRealName).find(Boolean) ?? EMPTY;
  const chatPhone = extractPhone(input.chat_history_log) || extractPhone(input.message) || extractPhone(input.phone);
  const phoneFromConversation = extractPhone(input.chat_history_log) || extractPhone(input.message);
  const memoryDown = normalizeMemoryDownPayment(memoryValue(memory, ['down payment', 'down_payment', 'downpayment']), normalizeAmount, TRADE_IN_INTENT);
  const inputDown = clean(input.down_payment ?? EMPTY);
  const vehicleSource = [historyForExtraction, messageForExtraction].filter(Boolean).join('\n');
  // Buyers on WhatsApp and Messenger use "carro económico" as a category
  // request. Keep this deterministic so it cannot be mistaken for a make/model.
  const extractedVehicle = FAMILY_PASSENGER_VAN_INTENT.test(vehicleSource)
    ? 'van'
    : ECONOMIC_SEDAN_INTENT.test(vehicleSource)
      ? 'Sedan'
      : GENERIC_SEDAN_INTENT.test(vehicleSource)
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
    ), isCampaignButton, isNonVehicleIntent);
  const hasExistingAdvisorMarker = [
    memoryValue(memory, ['vehicle_type', 'vehicle', 'type']),
    input.vehicle_type,
  ].some((value) => isAdvisorHandoffVehicle(value));
  const vehicle = extractedVehicle || (hasExistingAdvisorMarker || phoneFromConversation || (isWhatsAppChannel(input.channel) && chatPhone)
    ? ADVISOR_HANDOFF_VEHICLE
    : EMPTY);
  const vehicleYear = extractVehicleYear(vehicleSource);
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
    || recoverStaffordPreviousFinancing(rawHistory, policy, input.channel);
  const confirmedQuestionDown = affirmativeDownConfirmation(latestInboundMessage)
    ? firstNonEmpty(
      extractQuestionedDownPayment(rawHistory),
      extractQuestionedDownPayment(input.previous_predicted_bot_question ?? EMPTY),
    )
    : EMPTY;
  const cashDownCandidate = firstValidAmount(
    explicitCashDown,
    confirmedQuestionDown,
    extractStandaloneDownPayment(rawMessage),
    extractStandaloneDownPayment(rawHistory),
    isPhoneAreaCodeAmount(memoryDown, chatPhone) || (vehicleYear !== null && normalizeAmount(memoryDown) === String(vehicleYear)) ? EMPTY : memoryDown,
    campaignReply || isPhoneAreaCodeAmount(inputDown, chatPhone) || (vehicleYear !== null && normalizeAmount(inputDown) === String(vehicleYear)) ? EMPTY : inputDown,
  );
  const cashDown = isPhoneAreaCodeAmount(cashDownCandidate, chatPhone) && !explicitCashDown
    ? EMPTY
    : cashDownCandidate;
  const tradeDown = firstValidAmount(
    extractTradeInDownPayment(messageForExtraction),
    extractTradeInDownPayment(historyForExtraction),
    extractTradeInDownPayment(memoryText(memory)),
  );
  const baseDown = cashDown || tradeDown;
  const conversationalSource = [clean(historyForExtraction), messageForExtraction].filter(Boolean).join('; ');
  let down = baseDown && TRADE_IN_INTENT.test(conversationalSource) && !/trade[- ]?in/i.test(baseDown)
    ? `${baseDown} + trade-in`
    : baseDown;
  const downPaymentRule = evaluateDownPayment(vehicle, down);
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

  const step: QualificationStep = qualificationStep(
    hasRealVehicle,
    policy.requiresLocation,
    customerLocation,
    policy.phoneSatisfiedByNative || Boolean(chatPhone),
  );
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
  const nextQuestion = questions[language][step];
  const completedOrder: Array<[string, boolean]> = policy.sourceAware
    ? [
      ['real_name', Boolean(realName)],
      ['vehicle_type', hasRealVehicle],
      ['customer_location', Boolean(customerLocation)],
      ['phone', Boolean(chatPhone) || policy.phoneSatisfiedByNative],
    ]
    : [
      ['real_name', Boolean(realName)],
      ['phone', Boolean(chatPhone)],
      ['vehicle_type', hasRealVehicle],
    ];
  const lastAnsweredField = [...completedOrder].reverse().find(([, complete]) => complete)?.[0] ?? null;
  const qualificationProgress: QualificationProgress = {
    step,
    last_answered_field: step === 'complete' ? 'phone' : lastAnsweredField,
    predicted_bot_question: nextQuestion,
    language,
    confidence: step === 'complete' ? 1 : 0.95,
    evidence: step === 'complete' ? 'complete' : 'normalized_fields',
  };
  const qualificationComplete = isQualificationComplete({
    real_name: realName,
    phone: chatPhone || (policy.phoneSatisfiedByNative ? 'native-whatsapp' : EMPTY),
    vehicle_type: vehicle,
    down_payment: down,
    purchase_timeline: timeline,
    has_identification: docs.id,
    has_income_proof: docs.income,
    bank_account: bankAccount,
  })
    && (!policy.requiresLocation || Boolean(customerLocation));
  const missingQualification = getMissingQualification(
    policy.phoneSatisfiedByNative || Boolean(chatPhone) ? 'provided' : EMPTY,
    hasRealVehicle,
    policy.requiresLocation,
    customerLocation,
  );
  return {
    real_name: realName,
    vehicle_type: vehicle,
    vehicle_year: vehicleYear,
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
