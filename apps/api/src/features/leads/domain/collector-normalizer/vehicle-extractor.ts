import { ADVISOR_HANDOFF_VEHICLE, EMPTY } from './constants';
import { isCampaignButton, isFalsePositiveVanVerb, isNonVehicleIntent, stripCampaignButtonPhrases, TRADE_IN_INTENT, ECONOMIC_SEDAN_INTENT, FAMILY_PASSENGER_VAN_INTENT, FOUR_DOOR_SPORTS_CAR_INTENT, GENERIC_SEDAN_INTENT, INDECISIVE_VEHICLE_INTENT } from './collector-intents';
import { VEHICLE_BRANDS, VEHICLE_CATEGORIES, VEHICLE_CONTEXT, VEHICLE_MODELS, extractExplicitVehicleTrim, extractVehicleLabel, isPossessiveVehicleStatement, normalizeVehicle, normalizeWhisperVehicleAliases } from './vehicle-normalizer';
import { resolveVehicleCandidate, type VehicleCandidate } from './candidate-resolver';
import { clean, stripNonConversationMetadata } from './text-cleaner';
import { isWhatsAppChannel } from './flow-policy';

export function isStaffordWhatsAppVehicleLabel(value: string, source: string | null | undefined, channel: string | null | undefined): boolean {
  if (!['stafford', 'country', 'lucki', 'carhub', 'alpha', 'action-cars', 'fredericksburg'].includes(clean(source).toLocaleLowerCase()) || !isWhatsAppChannel(channel)) return false;
  const candidate = clean(value);
  return /^(?:un|una|a|an|my|mi|the|como|quiero|busco|buscando|tengo|tienes|hay|have|do you have|looking for)\b/i.test(candidate)
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

function isVehicleOptionPrompt(line: string): boolean {
  const asksForChoice = /\b(?:what|which)\s+(?:(?:type|kind)\s+of\s+)?(?:vehicles?|cars?|trucks?)\b[\s\S]*\b(?:looking for|searching for|want|need|seeking)\b|\b(?:qu[eé]|cu[aá]l)\s+(?:(?:tipo|clase)\s+de\s+)?(?:veh[ií]culos?|autos?|carros?)\b[\s\S]*\b(?:buscando|busca|quiere|prefiere)\b/i.test(line);
  const options = line.match(/\b(?:sed[aá]ns?|suvs?|camionetas?|trucks?|trocas?|vans?|pickups?|pick-up)\b/gi) ?? [];
  return asksForChoice && options.length >= 2;
}

export function extractVehicle(message: string): string {
  const source = stripNonConversationMetadata(message).trim();
  if (!source) return EMPTY;
  const lines = source.split(/\n+/).map(clean).filter(Boolean);
  const candidates: VehicleCandidate[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    // Dealer prompts often list example body styles. They are not the buyer's
    // selection and must not become the normalized vehicle.
    if (isVehicleOptionPrompt(line)) continue;
    const candidate = normalizeWhisperVehicleAliases(stripCampaignButtonPhrases(line));
    if (!candidate || isCampaignButton(candidate) || isNonVehicleIntent(candidate)) continue;
    if (isFalsePositiveVanVerb(candidate)) continue;
    if (/^\s*(?:vehicle_type|vehicle_category)\s*[:=]/i.test(candidate)) continue;
    if (isPossessiveVehicleStatement(candidate)) continue;
    if (TRADE_IN_INTENT.test(candidate)
      && /\b(?:tengo|tiene|have|has|my|mi)\b/i.test(candidate)
      && !/\b(?:looking for|busco|quiero|want|interested in|interesado en)\b/i.test(candidate)) continue;
    const hasVehicleEvidence = (VEHICLE_MODELS.test(candidate) || VEHICLE_BRANDS.test(candidate) || VEHICLE_CATEGORIES.test(candidate))
      && !/\b(?:passport|pasaporte|license|licencia|bank\s+account|bank\s+statements?|income|document(?:s|os)?|identification|id)\b/i.test(candidate);
    const candidateForVehicle = /\b(?:need|needs|looking for|busco|quiero|want|interested in|interesado en|me interesa(?:n)?|estou procurando|estou [àa] procura|procuro|tenho interesse)\b/i.test(candidate) || hasVehicleEvidence
      ? candidate
      : candidate.split(/[;,]/, 1)[0];
    const withoutOtherFacts = candidateForVehicle
      .replace(/(?:\+?1[\s().-]*)?(?:\(?[2-9]\d{2}\)?[\s.-]*)\d{3}[\s.-]?\d{4}/g, ' ')
      .replace(/(?:down|enganche|inicial|deposit|dep[oó]sito)\s*(?:payment|pago)?\s*(?:is|es|de|:)?\s*\$?\s*[\d,.]+\s*k?/gi, '')
      .replace(/\b(?:today|hoy|asap|this week|esta semana|this month|este mes|next week|pr[oó]xima? semana|siguiente semana|next month|pr[oó]ximo mes|siguiente mes)\b/gi, '')
      .split(/;/, 1)[0]
      .trim();
    const requested = withoutOtherFacts.match(/(?:looking for|busco|quiero|want|interested in|interesado en|me interesa(?:n)?|estou procurando|estou [àa] procura|procuro|tenho interesse)\s+(?:a|an|un|una|um|uma)?\s*([^.!?]+)/i)?.[1];
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
    const category = withoutOtherFacts.match(/\b(small\s+rvs?|rvs?|suv|sedan|turismos?|trucks?|troka|trocas?|trokitas?|troquitas?|troques?|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión)\b/i)?.[1];
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
  const activeLine = lines[latest.lineIndex] ?? EMPTY;
  const alternativeConnector = activeLine.match(/\s+(o|or|y|and)\s+/i)?.[1] ?? 'o';
  const alternatives = activeLine.split(/\s+(?:o|or|y|and)\s+/i)
    .map((part) => normalizeWhisperVehicleAliases(part))
    .filter((part) => VEHICLE_MODELS.test(part) || VEHICLE_CATEGORIES.test(part))
    .map((part) => extractVehicleLabel(part))
    .filter((label, index, labels) => Boolean(label) && labels.findIndex((item) => item.toLocaleLowerCase() === label.toLocaleLowerCase()) === index);
  if (alternatives.length > 1) return alternatives.join(alternativeConnector.toLocaleLowerCase() === 'or' ? ' or ' : ' o ');
  // Preserve multiple makes/models even when Messenger transcription drops
  // the conjunction (for example, "Tacoma una RAM"). Pair an adjacent make
  // and model such as "Toyota Tacoma" before returning alternatives.
  const mentions = [
    ...Array.from(activeLine.matchAll(new RegExp(VEHICLE_BRANDS.source, 'gi')), (match) => ({ kind: 'brand' as const, label: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })),
    ...Array.from(activeLine.matchAll(new RegExp(VEHICLE_MODELS.source, 'gi')), (match) => ({ kind: 'model' as const, label: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })),
  ].sort((left, right) => left.start - right.start || (left.kind === 'brand' ? -1 : 1));
  const vehicleMentions: string[] = [];
  const consumedMentions = new Set<number>();
  for (let mentionIndex = 0; mentionIndex < mentions.length; mentionIndex += 1) {
    const mention = mentions[mentionIndex];
    if (consumedMentions.has(mentionIndex)) continue;
    if (mentions.slice(0, mentionIndex).some((earlier) => earlier.start <= mention.start && earlier.end >= mention.end)) continue;
    if (mention.kind === 'brand') {
      const adjacentModelIndex = mentions.findIndex((next) => next.kind === 'model' && next.start >= mention.end && /^\s*$/.test(activeLine.slice(mention.end, next.start)));
      if (adjacentModelIndex >= 0) {
        const adjacentModel = mentions[adjacentModelIndex];
        consumedMentions.add(adjacentModelIndex);
        vehicleMentions.push(extractVehicleLabel(`${mention.label} ${adjacentModel.label}`));
        continue;
      }
    }
    vehicleMentions.push(extractVehicleLabel(mention.label));
  }
  const distinctVehicleMentions = vehicleMentions.filter((label, index, labels) => label && labels.findIndex((item) => item.toLocaleLowerCase() === label.toLocaleLowerCase()) === index).sort((left, right) => left.localeCompare(right));
  if (distinctVehicleMentions.length > 1) return distinctVehicleMentions.join(' o ');
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
