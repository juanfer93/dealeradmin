import { describe, expect, it, vi, afterEach } from 'vitest';
import { LeadsController } from '../../presentation/leads.controller';

const originalNodeEnv = process.env.NODE_ENV;

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

function createController(runner: ReturnType<typeof createRunner>) {
  const dataSource = { createQueryRunner: vi.fn(() => runner) };
  const authService = { verifySession: vi.fn(() => true) };
  const copyLeadService = { execute: vi.fn() };
  return new LeadsController(dataSource as never, authService as never, copyLeadService as never);
}

describe('LeadsController deletion', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('treats a stale queue delete as an idempotent success when the lead is absent', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([[]]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'missing-lead', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: false });
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('removes the dealer queue relationship but preserves bulk-ingestion history', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-1' }],
      [{ lead_id: 'lead-1' }],
      [{ count: '0' }],
      [{ id: 'ingestion-row-1' }],
    ]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'lead-1', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: true });
    const calls = runner.query.mock.calls as unknown[][];
    expect(calls[1]?.[0]).toContain('DELETE FROM lead_dealers');
    expect(calls[3]?.[0]).toContain('FROM lead_ingestion_rows');
    expect(calls[4]).toBeUndefined();
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('removes the lead record when its last dealer relationship has no audit reference', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [{ id: 'lead-1' }],
      [{ lead_id: 'lead-1' }],
      [{ count: 0 }],
      [],
      [{ id: 'lead-1' }],
    ]);
    const controller = createController(runner);

    await expect(controller.delete({ cookies: {} } as never, 'lead-1', 'dealer-source'))
      .resolves.toEqual({ success: true, deletedLead: true, deletedRelationship: true });
    const calls = runner.query.mock.calls as unknown[][];
    expect(calls[4]?.[0]).toContain('DELETE FROM leads');
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });
});

describe('LeadsController lead editing', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('updates the lead and its dealer relationship in one transaction', async () => {
    process.env.NODE_ENV = 'production';
    const runner = createRunner([
      [],
      [],
      [{ id: 'lead-1' }],
      [{ lead_id: 'lead-1' }],
      [{ id: 'lead-1', dealerId: 'dealer-1', name: 'Ana Corregida', phone: '+13019876543' }],
    ]);
    const controller = createController(runner);

    await expect(controller.updateLead({ cookies: {} } as never, 'lead-1', {
      dealerId: 'dealer-1',
      name: 'Ana Corregida',
      phone: '3019876543',
      vehicle_type: 'Honda Civic',
      down_payment: '1500',
      identification: 'yes',
      bank_account: 'yes',
      documents: 'proof of income',
      purchase_timeline: 'this week',
    })).resolves.toEqual({
      success: true,
      lead: { id: 'lead-1', dealerId: 'dealer-1', name: 'Ana Corregida', phone: '+13019876543' },
    });

    const calls = runner.query.mock.calls as unknown[][];
    expect(calls[1]?.[0]).toContain('FROM leads l');
    expect(calls[2]?.[0]).toContain('UPDATE leads');
    expect(calls[3]?.[0]).toContain('UPDATE lead_dealers');
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
    expect(runner.release).toHaveBeenCalledOnce();
  });
});
