import { describe, expect, it, vi } from 'vitest';
import { BulkLeadService } from '../../application/bulk-lead.service';

function createRunner(results: unknown[][]) {
  let active = false;
  const runner = {
    connect: vi.fn(async () => undefined),
    startTransaction: vi.fn(async () => { active = true; }),
    query: vi.fn(async () => results.shift() ?? []),
    commitTransaction: vi.fn(async () => { active = false; }),
    rollbackTransaction: vi.fn(async () => { active = false; }),
    release: vi.fn(async () => undefined),
    get isTransactionActive() { return active; },
  };
  return runner;
}

describe('BulkLeadService', () => {
  it('rejects an existing phone while allowing other rows from the same batch', async () => {
    const runner = createRunner([
      [{ id: 'dealer-1', ghl_location_id: 'loc-1' }],
      [],
      [], [], [{ id: 'lead-new-1' }], [], [],
      [], [], [{ id: 'lead-new-2' }], [], [],
      [],
    ]);
    const service = new BulkLeadService({ createQueryRunner: vi.fn(() => runner) } as never);

    const result = await service.execute('dealer-1', 'Ana Torres | 3019876543 | SUV\nLuis Perez | 3019876544 | Sedan');

    expect(result.summary).toMatchObject({ received: 2, inserted: 2, duplicates: 0, invalid: 0 });
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('returns the existing lead name and phone when the number is already used in the target dealer', async () => {
    const runner = createRunner([
      [{ id: 'dealer-1', ghl_location_id: 'loc-1' }],
      [],
      [],
      [{ id: 'lead-existing', first_name: 'Ana', last_name: 'Torres', canonical_phone: '+13019876543' }],
      [],
      [],
    ]);
    const service = new BulkLeadService({ createQueryRunner: vi.fn(() => runner) } as never);

    const result = await service.execute('dealer-1', 'Carlos Ruiz | 3019876543 | SUV');

    expect(result.summary).toMatchObject({ received: 1, inserted: 0, duplicates: 1, invalid: 0 });
    expect(result.rows[0]).toMatchObject({ status: 'duplicate', leadId: 'lead-existing' });
    expect(result.rows[0]?.reason).toContain('Ana Torres');
    expect(result.rows[0]?.reason).toContain('+13019876543');
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('does not treat a phone used by another dealer as a duplicate', async () => {
    const runner = createRunner([
      [{ id: 'dealer-fredericksburg', ghl_location_id: 'loc-fred' }],
      [],
      [],
      [],
      [{ id: 'lead-fred' }],
      [],
      [],
      [],
    ]);
    const service = new BulkLeadService({ createQueryRunner: vi.fn(() => runner) } as never);

    const result = await service.execute('dealer-fredericksburg', 'Santiago Avalos | 3019876543 | SUV');

    expect(result.summary).toMatchObject({ received: 1, inserted: 1, duplicates: 0, invalid: 0 });
    expect(result.rows[0]).toMatchObject({ status: 'inserted', leadId: 'lead-fred' });
    const duplicateQuery = (runner.query.mock.calls as unknown[][]).find(([sql]) => String(sql).includes('FROM leads l'))?.[0];
    expect(duplicateQuery).toContain('COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $1');
  });
});
