import { describe, expect, it, vi } from 'vitest';
import { EASTERN_DEALER_IDS, GeoroutingService } from '../../domain/services/georouting.service';

describe('Easterns georouting engine', () => {
  function createService(lastAssigned: string | null = null) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('assigned_dealer_id = ANY')) return lastAssigned ? [{ assigned_dealer_id: lastAssigned }] : [];
      return [];
    });
    return { service: new GeoroutingService({ query } as never), query };
  }

  it.each([
    ['DE', EASTERN_DEALER_IDS.rosedale], ['Pennsylvania', EASTERN_DEALER_IDS.rosedale], ['NY', EASTERN_DEALER_IDS.rosedale], ['New Jersey', EASTERN_DEALER_IDS.rosedale],
    ['VA', EASTERN_DEALER_IDS.sterling],
  ])('resuelve el estado exclusivo %s sin importar la ciudad', async (state, expectedDealerId) => {
    const { service } = createService();
    await expect(service.resolveDealer({ state, city: 'Una ciudad cualquiera' })).resolves.toMatchObject({ dealerId: expectedDealerId });
  });

  it.each([
    ['Wilmington', EASTERN_DEALER_IDS.rosedale], ['Philadelphia', EASTERN_DEALER_IDS.rosedale], ['New York City', EASTERN_DEALER_IDS.rosedale],
    ['Jersey City', EASTERN_DEALER_IDS.rosedale], ['Richmond', EASTERN_DEALER_IDS.sterling],
  ])('infiere el estado por ciudad cuando falta state: %s', async (city, expectedDealerId) => {
    const { service } = createService();
    await expect(service.resolveDealer({ city })).resolves.toMatchObject({ dealerId: expectedDealerId });
  });

  it('prioriza el estado explícito sobre una ciudad de otra jurisdicción', async () => {
    const { service } = createService();
    await expect(service.resolveDealer({ state: 'VA', city: 'Baltimore' })).resolves.toMatchObject({ dealerId: EASTERN_DEALER_IDS.sterling });
  });

  it.each([
    [null, EASTERN_DEALER_IDS.rosedale, 'Previous: Laurel/None'],
    [EASTERN_DEALER_IDS.rosedale, EASTERN_DEALER_IDS.laurel, 'Previous: Rosedale'],
    [EASTERN_DEALER_IDS.laurel, EASTERN_DEALER_IDS.rosedale, 'Previous: Laurel/None'],
  ])('alterna Baltimore de forma determinista después de %s', async (lastAssigned, expectedDealerId, reason) => {
    const { service } = createService(lastAssigned);
    const result = await service.resolveDealer({ state: 'Maryland', city: 'Baltimore City' });
    expect(result).toMatchObject({ dealerId: expectedDealerId });
    expect(result.reason).toContain(reason);
  });

  it('reconoce Baltimore desde easterns_zone aunque falte city', async () => {
    const { service } = createService();
    await expect(service.resolveDealer({ easterns_zone: 'Baltimore County, MD' })).resolves.toMatchObject({ dealerId: EASTERN_DEALER_IDS.rosedale });
  });

  it.each([
    [null, EASTERN_DEALER_IDS.laurel, 'Previous: Sterling/None'],
    [EASTERN_DEALER_IDS.laurel, EASTERN_DEALER_IDS.sterling, 'Previous: Laurel'],
    [EASTERN_DEALER_IDS.sterling, EASTERN_DEALER_IDS.laurel, 'Previous: Sterling/None'],
  ])('alterna Southern MD/DC después de %s', async (lastAssigned, expectedDealerId, reason) => {
    const { service } = createService(lastAssigned);
    const result = await service.resolveDealer({ state: 'DC', city: 'Washington' });
    expect(result).toMatchObject({ dealerId: expectedDealerId });
    expect(result.reason).toContain(reason);
  });

  it.each(['Waldorf', 'La Plata', 'Lexington Park', 'Prince Frederick', 'Fort Washington', 'Oxon Hill'])('reconoce ciudad del sur de Maryland: %s', async (city) => {
    const { service } = createService();
    await expect(service.resolveDealer({ state: 'MD', city })).resolves.toMatchObject({ dealerId: EASTERN_DEALER_IDS.laurel });
  });

  it('resuelve central Maryland a Laurel y desconoce el histórico del round-robin', async () => {
    const { service } = createService(EASTERN_DEALER_IDS.rosedale);
    await expect(service.resolveDealer({ state: 'MD', easterns_zone: 'Centro de Maryland' })).resolves.toMatchObject({
      dealerId: EASTERN_DEALER_IDS.laurel,
      reason: 'Exclusive Zone: Central Maryland',
    });
  });

  it('usa Laurel como fallback y no deja vacío el motivo', async () => {
    const { service } = createService();
    await expect(service.resolveDealer({})).resolves.toEqual({ dealerId: EASTERN_DEALER_IDS.laurel, reason: 'Fallback Default' });
  });
});
