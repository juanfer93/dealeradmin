import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

export const EASTERN_DEALER_IDS = {
  rosedale: 'd1111111-1111-1111-1111-111111111111',
  laurel: 'd2222222-2222-2222-2222-222222222222',
  sterling: 'd3333333-3333-3333-3333-333333333333',
} as const;

type LocationPayload = {
  easterns_zone?: string | null;
  easterns_dealer_selected?: boolean | null;
  qualification_memory?: string | null;
  state?: string | null;
  city?: string | null;
  zip_code?: string | null;
};

type QueryClient = Pick<DataSource, 'query'>;

const STATE_ALIASES: Record<string, string> = {
  'DELAWARE': 'DE',
  'PENNSYLVANIA': 'PA',
  'NEW YORK': 'NY',
  'NEW JERSEY': 'NJ',
  'NUEVA JERSEY': 'NJ',
  'VIRGINIA': 'VA',
  'MARYLAND': 'MD',
  'DISTRICT OF COLUMBIA': 'DC',
  'WASHINGTON DC': 'DC',
  'WASHINGTON D.C.': 'DC',
};

function normalizeText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function stripPlaceSuffix(value: string): string {
  return normalizeText(value)
    .replace(/\s+(?:city|town|village|borough|municipality|plantation|cdp|census[- ]designated place)$/i, '')
    .trim();
}

function locationFromQualificationMemory(value: string | null | undefined): string {
  const memory = normalizeText(value);
  if (!memory) return '';
  // Only an explicit conversational selection is authoritative. A contact
  // name such as "Easterns Laurel" must never become a dealer selection.
  const match = memory.match(/(?:quiero\s+mi\s+auto\s+con\s+easterns|i\s+want\s+my\s+(?:car|vehicle)\s+with\s+easterns)\s+(baltimore|laurel|sterling)\b/i);
  return match?.[1] || '';
}

function cityFromQualificationMemory(value: string | null | undefined): string {
  const memory = normalizeText(value);
  if (!memory) return '';
  const keyed = memory.match(/(?:location|city|sede|ubicacion|zona)\s*[:=-]\s*([^;|]+)/i)?.[1];
  const conversational = memory.match(/(?:estoy|me\s+encuentro|vivo)\s+en\s+([^;|]+)/i)?.[1]
    ?? memory.match(/(?:located|live)\s+in\s+([^;|]+)/i)?.[1];
  const candidate = (keyed || conversational || '')
    .replace(/[,.]+/g, ' ')
    .replace(/\b(?:de|del|in|en)\s+(?:md|maryland|va|virginia|dc|de|delaware|pa|pennsylvania|ny|new york|nj|new jersey)\b/gi, '')
    .replace(/\b(?:md|maryland|va|virginia|dc|de|delaware|pa|pennsylvania|ny|new york|nj|new jersey)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate) return '';
  return candidate.match(/\b(baltimore|laurel|sterling)\b/i)?.[1] || candidate;
}

@Injectable()
export class GeoroutingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolveDealer(
    payload: LocationPayload,
    queryClient: QueryClient = this.dataSource,
    sourceDealerId?: string,
  ): Promise<{ dealerId: string; reason: string }> {
    const stateValue = normalizeText(payload.state);
    const explicitState = this.resolveState(stateValue);
    const city = normalizeText(payload.city) || cityFromQualificationMemory(payload.qualification_memory);
    const memoryZone = locationFromQualificationMemory(payload.qualification_memory);
    // A stale/partial custom field must not override an explicit ad/location
    // phrase captured in qualification_memory. GHL can send fragments such as
    // "f" in easterns_zone while the canonical answer is in memory.
    const zone = memoryZone || normalizeText(payload.easterns_zone);
    const explicitDealerSelected = payload.easterns_dealer_selected === true || Boolean(memoryZone);

    // The boolean is set by the GHL workflow when an ad/button phrase names a
    // dealer. A plain easterns_zone answer remains geographic input and keeps
    // Baltimore's round-robin behavior.
    if (explicitDealerSelected && zone.includes('baltimore')) {
      return { dealerId: EASTERN_DEALER_IDS.rosedale, reason: 'Explicit Easterns Zone: Baltimore → Rosedale' };
    }
    if (explicitDealerSelected && zone.includes('laurel')) {
      return { dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Explicit Easterns Zone: Laurel → Laurel' };
    }
    if (explicitDealerSelected && zone.includes('sterling')) {
      return { dealerId: EASTERN_DEALER_IDS.sterling, reason: 'Explicit Easterns Zone: Sterling → Sterling' };
    }

    const databaseLocation = city ? await this.lookupLocation(city, queryClient, explicitState) : null;
    const inferredState = explicitState || databaseLocation?.state_code || this.resolveState(zone);
    const state = explicitState || inferredState;
    const routingZone = databaseLocation?.easterns_routing_zone || '';

    if (routingZone === 'outside_md_va' || ['DE', 'PA', 'NY', 'NJ'].includes(state)) {
      return { dealerId: EASTERN_DEALER_IDS.rosedale, reason: `Exclusive Zone: State ${state}` };
    }
    if (routingZone === 'virginia' || state === 'VA') {
      return { dealerId: EASTERN_DEALER_IDS.sterling, reason: 'Exclusive Zone: State Virginia' };
    }
    if (state === 'DC') {
      return { dealerId: EASTERN_DEALER_IDS.sterling, reason: 'Exclusive Zone: State District of Columbia' };
    }
    if (routingZone === 'silver_spring_laurel' || routingZone === 'maryland_laurel') {
      return { dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Exclusive Zone: Maryland catalog → Laurel' };
    }

    // Laurel exists in multiple jurisdictions. When no state is stated, the
    // local catalog's MD-first resolution must win over the Easterns source
    // anchor (Rosedale); an explicit VA state was already handled above.
    if (state === 'MD' && (city === 'laurel' || zone.includes('laurel'))) {
      return { dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Exclusive Zone: Laurel, Maryland' };
    }

    if (routingZone === 'baltimore_overlap' || zone.includes('baltimore')) {
      const lastAssigned = await this.getLastAssignedInOverlap(
        [EASTERN_DEALER_IDS.rosedale, EASTERN_DEALER_IDS.laurel],
        'Baltimore Overlap',
        queryClient,
      );
      if (lastAssigned === EASTERN_DEALER_IDS.rosedale) {
        return { dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Baltimore Overlap: Round-Robin (Previous: Rosedale)' };
      }
      return { dealerId: EASTERN_DEALER_IDS.rosedale, reason: 'Baltimore Overlap: Round-Robin (Previous: Laurel/None)' };
    }

    if (
      routingZone === 'southern_md_overlap' ||
      zone.includes('sur de maryland') ||
      zone.includes('southern maryland') ||
      zone.includes('south maryland')
    ) {
      const lastAssigned = await this.getLastAssignedInOverlap(
        [EASTERN_DEALER_IDS.laurel, EASTERN_DEALER_IDS.sterling],
        'Southern MD/DC Overlap',
        queryClient,
      );
      if (lastAssigned === EASTERN_DEALER_IDS.laurel) {
        return { dealerId: EASTERN_DEALER_IDS.sterling, reason: 'Southern MD/DC Overlap: Round-Robin (Previous: Laurel)' };
      }
      return { dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Southern MD/DC Overlap: Round-Robin (Previous: Sterling/None)' };
    }

    if (state === 'MD' && (zone.includes('centro') || zone.includes('central'))) {
      return { dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Exclusive Zone: Central Maryland' };
    }

    return {
      dealerId: sourceDealerId ?? EASTERN_DEALER_IDS.laurel,
      reason: sourceDealerId ? 'Source dealer from GHL location (fallback)' : 'Fallback Default',
    };
  }

  private async getLastAssignedInOverlap(
    dealerIds: string[],
    reasonPrefix: string,
    queryClient: QueryClient,
  ): Promise<string | null> {
    await queryClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`easterns:${reasonPrefix}`]);
    const rows = (await queryClient.query(
      `SELECT assigned_dealer_id
       FROM lead_dealers
       WHERE assigned_dealer_id = ANY($1::uuid[])
         AND routing_override = false
         AND routing_reason LIKE $2
       ORDER BY created_at DESC, updated_at DESC
       LIMIT 1`,
      [dealerIds, `${reasonPrefix}:%`],
    )) as Array<{ assigned_dealer_id: string | null }>;
    return rows[0]?.assigned_dealer_id ?? null;
  }

  private async lookupLocation(city: string, queryClient: QueryClient, stateHint = ''): Promise<{ state_code: string; easterns_routing_zone: string | null } | null> {
    if (!city) return null;
    const rows = (await queryClient.query(
      `SELECT state_code, easterns_routing_zone
       FROM locations
       WHERE normalized_name = ANY($1::text[])
         AND ($2::char(2) = '' OR state_code = $2::char(2))
       ORDER BY CASE WHEN state_code = $2::char(2) THEN 0 WHEN state_code = 'MD' THEN 1 WHEN state_code = 'VA' THEN 2 ELSE 3 END, state_code`,
      [[city, stripPlaceSuffix(city)].filter((value, index, all) => value && all.indexOf(value) === index), stateHint.toUpperCase()],
    )) as Array<{ state_code: string; easterns_routing_zone: string | null }>;
    return rows[0] ?? null;
  }

  private resolveState(value: string): string {
    if (!value) return '';
    const upper = value.toUpperCase();
    const exact = STATE_ALIASES[upper];
    if (exact) return exact;
    const abbreviation = upper.match(/\b(DE|PA|NY|NJ|VA|MD|DC)\b/)?.[1];
    if (abbreviation) return abbreviation;
    return Object.entries(STATE_ALIASES).find(([name]) => upper.includes(name))?.[1] || '';
  }
}
