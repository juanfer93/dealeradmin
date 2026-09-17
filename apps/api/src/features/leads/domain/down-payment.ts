const CASH_PATTERNS = [
  /\bcash\b/i,
  /\bcontado\b/i,
  /\befectivo\b/i,
  /\bpaid\s+in\s+full\b/i,
  /\bpaga(?:r[aá]|r)?\s+de\s+contado\b/i,
];
export const CASH_DOWN_PAYMENT = 'Pagara en cash / de contado';
const TRADE_IN_PATTERNS = [
  /\btrade[\s-]?in\b/i,
  /\b(?:my|mi)\s+(?:car|vehicle|carro|auto|veh[ií]culo)\b/i,
  /\bcarro\s+como\s+enganche\b/i,
  /\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b/i,
  /\bchange\s+(?:my\s+)?(?:vehicle|car)\b/i,
  /\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto)\b/i,
];
const NO_DOWN_PATTERNS = /\b(?:no\s+(?:down(?:\s+payment)?|enganche|pago\s+inicial|dinero)|sin\s+(?:down|enganche|pago\s+inicial)|zero\s+down|\$?0\s*(?:down|enganche|pago\s+inicial)?)\b/i;

export type VehicleCategory = 'sedan' | 'luxury_sedan' | 'suv_or_van' | 'truck';

export type DownPaymentRequirement = {
  category: VehicleCategory | null;
  minimum: number | null;
  amount: number | null;
  meetsMinimum: boolean;
};

const TRUCK_PATTERN = /\b(?:truck|troca|trokita|troquita|troque|trokas|pickup|pick[- ]?up|camioneta|camion|camión|tacoma|tundra|f[- ]?150|f[- ]?250|f[- ]?350|maverick|ranger|silverado|sierra|colorado|frontier|titan|ridgeline|gladiator|ram)\b/i;
const SUV_OR_VAN_PATTERN = /\b(?:suv|van|minivan|crossover|highlander|rav\s*4|4\s*runner|sienna|grand caravan|caravan|pacifica|odyssey|transit|promaster|pilot|passport|cr[- ]?v|hr[- ]?v|tahoe|suburban|traverse|equinox|blazer|yukon|acadia|terrain|wrangler|cherokee|compass|renegade|durango|explorer|expedition|escape|edge|armada|rogue|pathfinder|sportage|telluride|sorento|palisade|santa fe|tucson|forester|outback|ascent|atlas|tiguan|cayenne|range rover|defender)\b/i;
const LUXURY_SEDAN_PATTERN = /\b(?:camaro|challenger|charger|mercedes(?:[- ]?benz)?|bmw|audi|lexus|acura|infiniti|genesis|cadillac|lincoln|volvo|tesla|porsche|jaguar)\b/i;
const SEDAN_PATTERN = /\b(?:sedan|civic|corolla|camry|accord|altima|sentra|versa|maxima|malibu|jetta|passat|sonata|elantra|optima|forte|rio|impala|avalon|prius|mustang|coupe|hatchback)\b/i;

function numericDownPayment(value: string | null | undefined): number | null {
  const normalized = normalizeDownPayment(value);
  if (!normalized || isCashDownPayment(normalized)) return isCashDownPayment(normalized) ? Number.POSITIVE_INFINITY : null;
  const amount = normalized.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k?)\b/i)?.[1];
  if (!amount) return null;
  const compact = amount.replace(/[$,\s]/g, '').toLowerCase();
  const parsed = Number.parseFloat(compact.replace(/k$/, ''));
  return Number.isFinite(parsed) ? (compact.endsWith('k') ? parsed * 1000 : parsed) : null;
}

export function classifyVehicle(value: string | null | undefined): VehicleCategory | null {
  const source = String(value ?? '').trim();
  if (!source) return null;
  if (TRUCK_PATTERN.test(source)) return 'truck';
  if (SUV_OR_VAN_PATTERN.test(source)) return 'suv_or_van';
  if (LUXURY_SEDAN_PATTERN.test(source)) return 'luxury_sedan';
  if (SEDAN_PATTERN.test(source)) return 'sedan';
  return null;
}

export function requiredDownPayment(value: string | null | undefined): number | null {
  switch (classifyVehicle(value)) {
    case 'sedan': return 1500;
    case 'luxury_sedan': return 2000;
    case 'suv_or_van': return 2000;
    case 'truck': return 3000;
    default: return null;
  }
}

export function evaluateDownPayment(vehicle: string | null | undefined, downPayment: string | null | undefined): DownPaymentRequirement {
  const category = classifyVehicle(vehicle);
  const minimum = requiredDownPayment(vehicle);
  const amount = numericDownPayment(downPayment);
  const isCash = isCashDownPayment(downPayment);
  const isTradeIn = isTradeInDownPayment(downPayment);
  return {
    category,
    minimum,
    amount: amount === Number.POSITIVE_INFINITY ? null : amount,
    // A trade-in is an accepted path on its own. Keep any cash amount in the
    // captured value, but do not require it to reach the vehicle minimum.
    meetsMinimum: minimum !== null && (isCash || isTradeIn || (amount !== null && amount >= minimum)),
  };
}

export function hasRequiredDownPayment(vehicle: string | null | undefined, downPayment: string | null | undefined): boolean {
  return evaluateDownPayment(vehicle, downPayment).meetsMinimum;
}

export function normalizeDownPayment(value: string | null | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) return '';
  if (NO_DOWN_PATTERNS.test(normalized)) return 'No down payment';
  return CASH_PATTERNS.some((pattern) => pattern.test(normalized)) ? CASH_DOWN_PAYMENT : normalized;
}

export function isCashDownPayment(value: string | null | undefined): boolean {
  const normalized = value?.trim() || '';
  return normalized === CASH_DOWN_PAYMENT || normalized.toLocaleLowerCase() === 'cash' || CASH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isTradeInDownPayment(value: string | null | undefined): boolean {
  const normalized = value?.trim() || '';
  return TRADE_IN_PATTERNS.some((pattern) => pattern.test(normalized));
}
