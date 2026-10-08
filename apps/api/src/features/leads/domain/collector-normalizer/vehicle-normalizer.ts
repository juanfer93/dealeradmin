import { ADVISOR_HANDOFF_VEHICLE, EMPTY } from './constants';
import { isAdvisorHandoffVehicle } from './flow-policy';
import { clean } from './text-cleaner';

export const VEHICLE_BRANDS = /\b(?:toyotas?|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subarus?|suvarus?|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|land rover|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion)\b/i;
export const VEHICLE_MODELS = /\b(?:grand caravan|grand cherokee|transit connect|promaster city|mustang|tacomas?|tacomos?|tacmas?|tecomas?|sti|rav\s*4|civic|civc|accord|camry|coroll?a|highlander|hilander|sienna|4\s*runner|for\s+runner|for\s+runer|tundra|sequoia|prius|avalon|f-?150|f-?250|f-?350|maverick|ranger|bronco|explorer|expedition|escape|edge|cr-?v|hr-?v|pilot|passport|ridgeline|odyssey|odisea|paila|sierra|silverado|tahoe|tajo|suburban|traverse|equinox|camaro|malibu|blazer|colorado|yukon|acadia|terrain|wrangler|gladiator|cherokee|compass|renegade|charger|challenger|durango|journey|caravan|pacifica|frontier|titan|rogue|pathfinder|altima|sentra|versa|maxima|armada|sportage|telluride|sorento|soul|rio|palisade|santa fe|tucson|elantra|sonata|veloster|wrx|forester|outback|ascent|impreza|atlas|tiguan|jetta|passat|cayenne|rlx|model [3syx]|f-?type|range rover|defender|wrx|highlander)\b/i;
export const VEHICLE_CATEGORIES = /\b(?:suv|sedan|truck|truk|troca|trokita|troquita|troque|trokas|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión)\b/i;
export const VEHICLE_TRIMS = /\b(?:\d+\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\b/i;
export const VEHICLE_CONTEXT = /\b(?:tengo|tiene|tienen|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en|estou procurando|estou [àa] procura|procuro|tenho interesse)\b/i;
export const VEHICLE_YEAR_PATTERN = /\b(19\d{2}|20(?:0\d|1\d|2[0-6]))\b/g;
export const VEHICLE_YEAR_CONTEXT = /\b(?:vehicle|car|auto|carro|coche|veh[ií]culo|model|modelo|year|año|ano|f[- ]?\d{3})\b/i;
export const FINANCIAL_AMOUNT_PREFIX = /(?:\$|doy|dar(?:é|as|emos)?|pongo|poner|tengo|have|i have|i can put|puedo poner|down|payment|enganche|inicial|pago\s+inicial|cuota\s+inicial|deposit|dep[oó]sito)\s*(?:de|para|as|is|es|:)?\s*$/i;
export const FINANCIAL_AMOUNT_SUFFIX = /^\s*(?:down|payment|enganche|inicial|pago\s+inicial|cuota\s+inicial|deposit|dep[oó]sito)\b/i;
export const FINANCIAL_CONTEXT_BEFORE_AMOUNT = /\b(?:down|payment|enganche|inicial|pago\s+inicial|cuota\s+inicial|deposit|dep[oó]sito)\b[^\d]{0,40}$/i;

export function canonicalVehicleLabel(value: string): string {
  const normalized = clean(value)
    .replace(/-{2,}/g, '-')
    .replace(/\btoyotas?\b/gi, 'Toyota')
    .replace(/\bsuvarus?\b/gi, 'Subaru')
    .replace(/\bcorola\b/gi, 'Corolla')
    .replace(/\bcivc\b/gi, 'Civic')
    .replace(/\bacoitd\b/gi, 'Accord')
    .replace(/\btacomas?\b/gi, 'Tacoma')
    .replace(/\btacomos?\b/gi, 'Tacoma')
    .replace(/\btacmas?\b/gi, 'Tacoma')
    .replace(/\btecomas?\b/gi, 'Tacoma')
    .replace(/\bodisea\b/gi, 'Odyssey')
    .replace(/\bpaila\b/gi, 'Pilot')
    .replace(/\btajo\b/gi, 'Tahoe')
    .replace(/\brav\s*4\b/gi, 'RAV4')
    .replace(/\bfor\s+run(?:ner|er)\b/gi, '4Runner')
    .replace(/\b4\s*runner\b/gi, '4Runner')
    .replace(/\bhilander\b/gi, 'Highlander')
    .replace(/\bcrv\b/gi, 'CR-V')
    .replace(/\bhrv\b/gi, 'HR-V');
  const canonicalToken = (token: string): string => {
    const lower = token.toLocaleLowerCase();
    if (lower === 'gmc' || lower === 'bmw' || lower === 'vw') return lower.toLocaleUpperCase();
    if (lower === 'sti') return 'STI';
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

export function canonicalVehicleCategory(value: string): string {
  return clean(value).replace(/\b(?:truk|troca|trokita|troquita|troque|trokas|camioneta|camionetq|camion|camión)\b/gi, 'truck');
}

export function extractVehicleLabel(value: string | null | undefined): string {
  const source = clean(value)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:tengo|tiene|tienen|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en|estou procurando|estou [àa] procura|procuro|tenho interesse)\b/gi, ' ')
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
    const afterBrand = source.slice(source.toLocaleLowerCase().indexOf(brand.toLocaleLowerCase()) + brand.length).trim();
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

export function extractExplicitVehicleTrim(value: string, label: string): string {
  const model = label.match(VEHICLE_MODELS)?.[0];
  if (!model || VEHICLE_TRIMS.test(label)) return EMPTY;
  const escapedModel = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.match(new RegExp(`\\b${escapedModel}\\b\\s+(?:con|with)\\s+(?:(?:el|la|the)\\s+)?(?:(?:paquete|package)\\s+)?(\\d+\\s*lt|lt|xle|le|se|sr5|limited|sport|touring|ex)\\b`, 'i'))?.[1] ?? EMPTY;
}

export function isVehicleStatement(value: string | null | undefined): boolean {
  const candidate = clean(value);
  if (!candidate) return false;
  const label = extractVehicleLabel(candidate);
  if (!label) return false;
  const withoutContext = candidate
    .replace(/\b(?:tengo|tiene|tienen|have|has|i have|my vehicle is|mi (?:carro|auto|veh[ií]culo) es|estoy buscando|ando buscando|looking for|busco|buscando|quiero|want|interested in|interesado en)\b/gi, ' ')
    .replace(/\b(?:a|an|un|una|my|mi|the|carro|auto|car|vehicle|veh[ií]culo)\b/gi, ' ')
    .replace(/[!?.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return VEHICLE_CONTEXT.test(candidate) || withoutContext.toLocaleLowerCase() === label.toLocaleLowerCase();
}

export function extractVehicleYear(value: string | null | undefined): number | null {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter(Boolean);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const match of line.matchAll(VEHICLE_YEAR_PATTERN)) {
      const year = Number(match[1]);
      const index = match.index ?? 0;
      const before = line.slice(Math.max(0, index - 60), index);
      const after = line.slice(index + match[0].length, index + match[0].length + 60);
      if (FINANCIAL_AMOUNT_PREFIX.test(before) || FINANCIAL_AMOUNT_SUFFIX.test(after) || FINANCIAL_CONTEXT_BEFORE_AMOUNT.test(before)) continue;
      const neighborhood = [lines[lineIndex - 1] ?? '', line, lines[lineIndex + 1] ?? ''].join(' ');
      if (VEHICLE_BRANDS.test(neighborhood) || VEHICLE_MODELS.test(neighborhood) || VEHICLE_CATEGORIES.test(neighborhood) || VEHICLE_CONTEXT.test(neighborhood) || VEHICLE_YEAR_CONTEXT.test(neighborhood)) return year;
    }
  }
  return null;
}

export function normalizeVehicle(value: string, isCampaignButton: (candidate: string) => boolean, isNonVehicleIntent: (candidate: string) => boolean): string {
  let source = clean(value).replace(/-{2,}/g, '-').replace(/(?:19|20)\d{2}(?:\d{2})*$/i, '').trim();
  if (isAdvisorHandoffVehicle(source)) return ADVISOR_HANDOFF_VEHICLE;
  if (isCampaignButton(source) || isNonVehicleIntent(source)) return EMPTY;
  const labeled = source.match(/^(.+?)\s*vehicle(?:_type)?\s*:\s*(.+)$/i);
  if (labeled?.[1]) source = labeled[1].trim();
  const doubled = source.match(/^(.{2,}?)\1$/i);
  if (doubled?.[1]) source = doubled[1].trim();
  if (!source) return EMPTY;
  if (source.includes('—')) return VEHICLE_BRANDS.test(source) || VEHICLE_MODELS.test(source) || VEHICLE_CATEGORIES.test(source) ? source : EMPTY;
  const extractedLabel = extractVehicleLabel(source);
  if (extractedLabel) return extractedLabel;
  const lower = source.toLowerCase();
  const category = lower.match(/\b(suv|sedan|truck|troca|pickup|pick-up|van|minivan|crossover|coupe|coupé|hatchback|motorcycle|moto|camioneta|camionetq|camion|camión|carro|auto|coche)\b/i)?.[1];
  const brand = source.match(/\b(toyotas?|hummer|honda|ford|nissan|chevrolet|chevy|hyundai|kia|mazda|subarus?|suvarus?|volkswagen|vw|jeep|ram|gmc|bmw|mercedes|audi|lexus|acura|volvo|tesla|dodge|chrysler|buick|cadillac|lincoln|infiniti|genesis|mini|porsche|jaguar|land rover|rivian|lucid|mitsubishi|pontiac|saturn|oldsmobile|fiat|suzuki|isuzu|scion)\b/i)?.[1];
  if (category && brand) return `${category.replace('troca', 'truck')} — ${source}`;
  if (category && clean(source).toLocaleLowerCase() === category.toLocaleLowerCase()) return category.replace(/^troca$/i, 'truck').replace(/^camion(?:eta|etq)?$/i, 'truck').replace(/^camión(?:eta)?$/i, 'truck');
  return EMPTY;
}
