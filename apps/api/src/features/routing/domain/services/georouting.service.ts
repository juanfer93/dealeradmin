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
  'VIRGINIA': 'VA',
  'MARYLAND': 'MD',
  'DISTRICT OF COLUMBIA': 'DC',
  'WASHINGTON DC': 'DC',
  'WASHINGTON D.C.': 'DC',
};

const SOUTHERN_MARYLAND_CITIES = new Set([
  'waldorf', 'la plata', 'indian head', 'bryans road', 'hughesville', 'port tobacco', 'saint charles', 'st charles',
  'nanjemoy', 'prince frederick', 'dunkirk', 'owings', 'chesapeake beach', 'north beach', 'lusby', 'solomons',
  'huntingtown', 'lexington park', 'california', 'leonardtown', 'great mills', 'hollywood', 'mechanicsville',
  'charlotte hall', 'clinton', 'fort washington', 'oxon hill', 'temple hills', 'suitland', 'upper marlboro', 'bowie',
]);

const CITY_STATE_ALIASES: Record<string, string | null> = {
  'wilmington': 'DE', 'dover': 'DE', 'newark': null, 'middletown': 'DE', 'smyrna': 'DE', 'milford': 'DE', 'seaford': 'DE', 'georgetown': 'DE',
  'philadelphia': 'PA', 'pittsburgh': 'PA', 'allentown': 'PA', 'erie': 'PA', 'reading': 'PA', 'scranton': 'PA', 'bethlehem': 'PA', 'lancaster': 'PA', 'harrisburg': 'PA', 'york': 'PA', 'chester': 'PA', 'king of prussia': 'PA', 'west chester': 'PA',
  'new york': 'NY', 'new york city': 'NY', 'brooklyn': 'NY', 'queens': 'NY', 'bronx': 'NY', 'buffalo': 'NY', 'rochester': 'NY', 'yonkers': 'NY', 'syracuse': 'NY', 'albany': 'NY', 'utica': 'NY', 'white plains': 'NY', 'new rochelle': 'NY', 'mount vernon': 'NY',
  'jersey city': 'NJ', 'paterson': 'NJ', 'elizabeth': 'NJ', 'trenton': 'NJ', 'clifton': 'NJ', 'camden': 'NJ', 'passaic': 'NJ', 'union city': 'NJ', 'edison': 'NJ', 'woodbridge': 'NJ', 'new brunswick': 'NJ', 'princeton': 'NJ',
  'richmond': 'VA', 'virginia beach': 'VA', 'norfolk': 'VA', 'chesapeake': 'VA', 'newport news': 'VA', 'alexandria': 'VA', 'arlington': 'VA', 'fredericksburg': 'VA', 'fairfax': 'VA', 'leesburg': 'VA', 'ashburn': 'VA', 'manassas': 'VA', 'winchester': 'VA', 'charlottesville': 'VA', 'roanoke': 'VA', 'hampton': 'VA',
  'baltimore': 'MD', 'baltimore city': 'MD', 'annapolis': 'MD', 'rockville': 'MD', 'gaithersburg': 'MD', 'germantown': 'MD', 'frederick': 'MD', 'columbia': 'MD', 'silver spring': 'MD', 'bethesda': 'MD', 'hyattsville': 'MD', 'towson': 'MD', 'elkton': 'MD', 'bel air': 'MD', 'hagerstown': 'MD', 'salisbury': 'MD', 'ocean city': 'MD', 'laurel': 'MD',
  'washington': 'DC', 'washington dc': 'DC', 'district of columbia': 'DC',
};

function normalizeText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

@Injectable()
export class GeoroutingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolveDealer(payload: LocationPayload, queryClient: QueryClient = this.dataSource): Promise<{ dealerId: string; reason: string }> {
    const stateValue = normalizeText(payload.state);
    const explicitState = STATE_ALIASES[stateValue.toUpperCase()] || stateValue.toUpperCase();
    const city = normalizeText(payload.city);
    const zone = normalizeText(payload.easterns_zone);
    const explicitDealerSelected = payload.easterns_dealer_selected === true;

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

    const inferredState = this.inferState(city, zone);
    const state = explicitState || inferredState;

    if (['DE', 'PA', 'NY', 'NJ'].includes(state)) {
      return { dealerId: EASTERN_DEALER_IDS.rosedale, reason: `Exclusive Zone: State ${state}` };
    }
    if (state === 'VA') {
      return { dealerId: EASTERN_DEALER_IDS.sterling, reason: 'Exclusive Zone: State Virginia' };
    }

    if (city === 'baltimore' || city === 'baltimore city' || zone.includes('baltimore')) {
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
      state === 'DC' ||
      zone.includes('washington') ||
      zone.includes('sur de maryland') ||
      zone.includes('southern maryland') ||
      zone.includes('south maryland') ||
      this.isSouthernMarylandCity(city)
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

    return { dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Fallback Default' };
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

  private isSouthernMarylandCity(city: string): boolean {
    return SOUTHERN_MARYLAND_CITIES.has(city);
  }

  private inferState(city: string, zone: string): string {
    const stateToken = zone.match(/\b(DE|PA|NY|NJ|VA|MD|DC)\b/i)?.[1];
    if (stateToken) return stateToken.toUpperCase();
    const direct = CITY_STATE_ALIASES[city];
    if (direct) return direct;
    const zoneEntry = Object.entries(CITY_STATE_ALIASES).find(([cityName]) => zone.includes(cityName));
    return zoneEntry?.[1] || '';
  }
}
