import { clean } from './text-cleaner';

export const ECONOMIC_SEDAN_INTENT = /\b(?:(?:carro|carros|auto|autos|coche|coches|veh[ií]culo|veh[ií]culos)\s+econ[oó]mic[oa]s?|(?:economic|economical|affordable|budget)\s+(?:car|cars|auto|vehicle)|algo\s+econ[oó]mic[oa]?)\b/i;
export const GENERIC_SEDAN_INTENT = /\b(?:small|compact|affordable|budget|economical)\s+(?:car|auto|coche|carro|vehicle)\b|\b(?:carro|auto|coche|veh[ií]culo)[\s\W_]{1,8}(?:pequeñ[oa]|pequen[oa]|peken[oa]|chic[oa])\b/i;
export const FOUR_DOOR_SPORTS_CAR_INTENT = /\b(?:four|4)[-\s]?door\s+sports?\s+cars?\b/i;
export const FAMILY_PASSENGER_VAN_INTENT = /\b(?:algo\s+)?familiar\b[\s\S]{0,80}\bpasajeros?\b/i;
export const INDECISIVE_VEHICLE_INTENT = /\b(?:anything\s+(?:you\s+)?(?:have|got|offer|carry|available|in\s+stock)|whatever\s+(?:you\s+have|you(?:'ve|\s+have)?\s+got|is\s+available)|(?:i(?:'m|\s+am)\s+)?(?:not\s+sure|unsure|undecided|do\s+not\s+know|don't\s+know|have\s+no\s+idea|no\s+idea|no\s+preference)\s+(?:about\s+|on\s+|what\s+|which\s+)?(?:vehicle|car|auto|coche|carro|truck|suv|sedan)?|(?:it\s+)?does(?:n't|\s+not)\s+matter\s+(?:what|which)\s+(?:vehicle|car|auto|coche|carro)|i\s+do(?:n't|\s+not)\s+care\s+(?:what|which)\s+(?:vehicle|car|auto|coche|carro)|(?:any|whatever)\s+(?:vehicle|car|auto|coche|carro)|(?:no\s+(?:sé|se)\s+(?:qué|que)|no\s+tengo\s+(?:idea|preferencia|claro\s+qué|claro\s+que)|estoy\s+indecis[oa]|no\s+estoy\s+segur[oa]|me\s+da\s+igual|me\s+es\s+igual)\s*(?:de\s+|sobre\s+|qué\s+|que\s+)?(?:carro|auto|coche|veh[ií]culo|vehiculo|camioneta)|(?:cualquiera|lo\s+que\s+sea|el\s+que\s+sea|la\s+que\s+sea)(?:\s+(?:carro|auto|coche|veh[ií]culo|vehiculo))?)\b/i;

export const NO_DOWN_PAYMENT_RESPONSE = /\b(?:no(?:\s+\w+){0,3}\s+(?:down(?:\s+payment)?|enganche|pago\s+inicial|dinero)|sin\s+(?:down|enganche|pago\s+inicial)|zero\s+down|\$?0\s*(?:down|enganche|pago\s+inicial)|no\s+(?:cuento|cuenta)\s+con\s+(?:dinero|down|enganche|pago\s+inicial))\b/i;
export const TRADE_IN_INTENT = /\btrade[- ]?in\b|\b(?:carro|auto|veh[ií]culo)\s+como\s+enganche\b|\b(?:cambiar|cambio)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\bchange\s+(?:my\s+)?(?:vehicle|car|van|truck)\b|\b(?:entregar|entrego|entregue|dar|doy)\s+(?:(?:mi|el|de)\s+)?(?:veh[ií]culo|carro|auto|van|troca|camioneta|camion)\b|\b(?:and|y)\s+(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion)\s+(?:for|para)\s+(?:trade(?:[- ]?in)?|entregar|cambiar|dar)\b|\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b[\s\S]{0,24}\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b|\b(?:\d{3,5}\s*(?:dollars?|d[oó]lares?)|down|payment|enganche)\b[\s\S]{0,24}\b(?:my|mi)\s+(?:car|vehicle|van|truck|carro|auto|veh[ií]culo|troca|camioneta|camion|ban)\b/i;
export const NON_VEHICLE_INTENT_VALUES = /^(?:(?:(?:quiero|necesito|me gustar[ií]a|me interesa)\s+)?(?:m[aá]s\s+)?(?:informaci[oó]n|info|detalles?|details?|information)|more\s+(?:information|info|details?)|learn\s+more)$/i;

// "Van a llamar/hacer/comprar" is a Spanish verb phrase, not a vehicle answer.
export function isFalsePositiveVanVerb(value: string): boolean {
  const candidate = clean(value);
  if (!/\bvan\s+a\s+[a-záéíóúüñ]+(?:ar|er|ir)\b/i.test(candidate)) return false;
  return !/(?:^|\b)(?:una?\s+|mi\s+|my\s+|tengo\s+|tiene\s+|busco\s+|buscando\s+|quiero\s+|looking\s+for\s+|need\s+|needs\s+|have\s+|has\s+)(?:van)\b|^van$|\bvan\s+(?:con|para|de)\b/i.test(candidate);
}

// HighLevel sometimes exposes a technical profile label as the Messenger
// contact name. It is not buyer identity evidence and must never be persisted
// as the lead's real name.
export function isCampaignButton(value: string): boolean {
  const normalized = clean(value)
    .replace(/([!?])\s*\d{1,3}$/, '$1')
    .replace(/[!?.,]/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /^(?:quiero mi auto con eastern|quiero (?:un )?auto hoy|i want (?:a )?car today|quiero financiar un auto(?: con ustedes)?|me gustaria financiar un auto(?: con ustedes)?|financiar un auto(?: con ustedes)?|(?:quiero )?financiar con easterns?)$/.test(normalized);
}

export function isNonVehicleIntent(value: string): boolean {
  const normalized = clean(value).replace(/[!?.,]/g, '').trim();
  return NON_VEHICLE_INTENT_VALUES.test(normalized);
}

export function stripCampaignButtonPhrases(value: string): string {
  return value
    .replace(/\bquiero mi auto con eastern\b/gi, ' ')
    .replace(/\bquiero (?:un )?auto hoy\b/gi, ' ')
    .replace(/\bi want (?:a )?car today\b/gi, ' ')
    .replace(/\bquiero financiar un auto(?: con ustedes)?\b/gi, ' ')
    .replace(/\bme gustar[ií]a financiar un auto(?: con ustedes)?\b/gi, ' ')
    .replace(/\b(?:quiero )?financiar con easterns?\b/gi, ' ');
}
