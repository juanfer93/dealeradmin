import { ADVISOR_HANDOFF_VEHICLE, EMPTY } from './constants';
import { isCampaignButton, isFalsePositiveVanVerb, isNonVehicleIntent, stripCampaignButtonPhrases, TRADE_IN_INTENT, ECONOMIC_SEDAN_INTENT, FAMILY_PASSENGER_VAN_INTENT, FOUR_DOOR_SPORTS_CAR_INTENT, GENERIC_SEDAN_INTENT, INDECISIVE_VEHICLE_INTENT } from './collector-intents';
import { VEHICLE_BRANDS, VEHICLE_CATEGORIES, VEHICLE_CONTEXT, VEHICLE_MODELS, extractExplicitVehicleTrim, extractVehicleLabel, normalizeVehicle, normalizeWhisperVehicleAliases } from './vehicle-normalizer';
import { resolveVehicleCandidate, type VehicleCandidate } from './candidate-resolver';
import { clean } from './text-cleaner';
import { isWhatsAppChannel } from './flow-policy';

export function isStaffordWhatsAppVehicleLabel(value: string, source: string | null | undefined, channel: string | null | undefined): boolean {
  if (!['stafford', 'country', 'lucki', 'action-cars'].includes(clean(source).toLocaleLowerCase()) || !isWhatsAppChannel(channel)) return false;
  const candidate = clean(value);
  return /^(?:un|una|a|an|my|mi|the)\s+/i.test(candidate)
    && (VEHICLE_BRANDS.test(candidate) || VEHICLE_MODELS.test(candidate) || VEHICLE_CATEGORIES.test(candidate));
}

export function inferVehicleIntent(vehicleSource: string, explicitVehicle: string): string {
  return FAMILY_PASSENGER_VAN_INTENT.test(vehicleSource)
    ? 'van'
    : ECONOMIC_SEDAN_INTENT.test(vehicleSource)
      ? 'Sedan'
      : GENERIC_SEDAN_INTENT.test(vehicleSource)
        ? 'Sedan'
        : FOUR_DOOR_SPORTS_CAR_INTENT.test(vehicleSource)
          ? 'Sedan'
          : explicitVehicle || (INDECISIVE_VEHICLE_INTENT.test(vehicleSource) ? 'Sedan' : EMPTY);
}

export function extractVehicle(message: string): string {
  const source = String(message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return EMPTY;
  const lines = source.split(/\n+/).map(clean).filter(Boolean);
  const candidates: VehicleCandidate[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const candidate = normalizeWhisperVehicleAliases(stripCampaignButtonPhrases(line));
    if (!candidate || isCampaignButton(candidate) || isNonVehicleIntent(candidate)) continue;
    if (isFalsePositiveVanVerb(candidate)) continue;
    if (/^\s*(?:vehicle_type|vehicle_category)\s*[:=]/i.test(candidate)) continue;
    if (TRADE_IN_INTENT.test(candidate)
      && /\b(?:tengo|tiene|have|has|my|mi)\b/i.test(candidate)
      && !/\b(?:looking for|busco|quiero|want|interested in|interesado en)\b/i.test(candidate)) continue;
    const hasVehicleEvidence = (VEHICLE_MODELS.test(candidate) || VEHICLE_BRANDS.test(candidate) || VEHICLE_CATEGORIES.test(candidate))
      && !/\b(?:passport|pasaporte|license|licencia|bank\s+account|bank\s+statements?|income|document(?:s|os)?|identification|id)\b/i.test(candidate);
    const candidateForVehicle = /\b(?:need|needs|looking for|busco|quiero|want|interested in|interesado en|estou procurando|estou [àa] procura|procuro|tenho interesse)\b/i.test(candidate) || hasVehicleEvidence
      ? candidate
      : candidate.split(/[;,]/, 1)[0];
    const withoutOtherFacts = candidateForVehicle
      .replace(/(?:\+?1[\s().-]*)?(?:\(?[2-9]\d{2}\)?[\s.-]*)\d{3}[\s.-]?\d{4}/g, ' ')
      .replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?\s*[\d,.]+\s*k?/gi, '')
      .replace(/\b(?:today|hoy|asap|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|siguiente semana|next month|pr[oó]ximo mes|siguiente mes)\b/gi, '')
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
    const category = withoutOtherFacts.match(/\b(suv|sedan|turismos?|trucks?|troka|trocas?|trokitas?|troquitas?|troques?|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión)\b/i)?.[1];
    const transcriptionModelAlias = /\b(?:odisea|paila|tajo)\b/i.test(candidate);
    const hasModel = VEHICLE_MODELS.test(withoutOtherFacts) || transcriptionModelAlias;
    const brand = withoutOtherFacts.match(VEHICLE_BRANDS)?.[0] ?? EMPTY;
    const imageEvidence = /\b(?:image\s+(?:interpretation|description|decription)|\[image\s+interpretation\])\b/i.test(candidate);
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
        isColloquialTruck: /\b(?:troka|trocas?|trokitas?|troquitas?|troques?|camionetq)\b/i.test(candidate),
        isSyntheticEvidence: imageEvidence,
      });
    }
  }

  const textualCandidates = candidates.filter((candidate) => !candidate.isSyntheticEvidence);
  const latest = resolveVehicleCandidate(textualCandidates.length > 0 ? textualCandidates : candidates);
  if (!latest) return EMPTY;
  const brands = [...new Set(candidates.map((candidate) => candidate.brand).filter(Boolean).map((brand) => brand.toLocaleLowerCase()))];
  if (!VEHICLE_BRANDS.test(latest.label) && brands.length === 1 && (latest.hasModel || latest.isColloquialTruck)) {
    const brand = candidates.find((candidate) => candidate.brand && candidate.brand.toLocaleLowerCase() === brands[0])?.brand ?? brands[0];
    const combined = clean(`${brand} ${latest.label}`);
    const trim = extractExplicitVehicleTrim(source, combined);
    return clean(`${combined}${trim ? ` ${trim}` : EMPTY}`).replace(/\b([a-z]+)\b/gi, (token) => token[0].toLocaleUpperCase() + token.slice(1).toLocaleLowerCase()).replace(/\b(\d)\s*lt\b/gi, '$1LT');
  }
  const normalizedBest = clean(latest.label);
  const trim = extractExplicitVehicleTrim(source, normalizedBest);
  return clean(`${normalizedBest}${trim ? ` ${trim}` : EMPTY}`).replace(/\b(\d)\s*lt\b/gi, '$1LT');
}

export { ADVISOR_HANDOFF_VEHICLE, VEHICLE_BRANDS, VEHICLE_CATEGORIES, VEHICLE_MODELS, normalizeVehicle };
