import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CopyLeadService } from '../../application/copy-lead.service';

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

const sourceRow = {
  lead_id: 'lead-1',
  source_dealer_id: 'dealer-source',
  source_dealer_name: 'Dealer Source',
  first_name: 'Jose',
  last_name: 'Lopez',
  canonical_phone: '+15551234567',
  vehicle_type: 'Honda CR-V',
  down_payment: '2000',
  purchase_timeline: 'this month',
  documents: 'proof of income: yes',
  identification: 'yes',
  bank_account: 'yes',
  easterns_zone: null,
  message_text: 'Jose Lopez +15551234567 Honda CR-V, 2000 down.',
};

describe('CopyLeadService', () => {
  it('blocks a copy when the phone is already used in the target dealer', async () => {
    const runner = createRunner([
      [sourceRow],
      [{ id: 'dealer-target', name: 'Dealer Target' }],
      [],
      [{ id: 'lead-duplicate' }],
    ]);
    const dataSource = { createQueryRunner: vi.fn(() => runner) };
    const service = new CopyLeadService(dataSource as never);
    const calls = runner.query.mock.calls as unknown[][];

    await expect(service.execute('lead-1', { sourceDealerId: 'dealer-source', targetDealerId: 'dealer-target' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(runner.query).toHaveBeenCalledTimes(4);
    expect(calls[2]?.[0]).toContain('pg_advisory_xact_lock');
    expect(calls[3]?.[0]).toContain('canonical_phone');
    expect(calls[3]?.[0]).toContain('COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $3');
    expect(calls[3]?.[0]).toContain('CONCAT_WS');
    expect(calls[3]?.[1]).toEqual(['lead-1', sourceRow.canonical_phone, 'dealer-target', 'jose lopez']);
    expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(runner.release).toHaveBeenCalledOnce();
  });

  it('allows the same phone in the target dealer when the name is different', async () => {
    const runner = createRunner([
      [sourceRow],
      [{ id: 'dealer-target', name: 'Dealer Target' }],
      [],
      [],
      [],
    ]);
    const dataSource = { createQueryRunner: vi.fn(() => runner) };
    const service = new CopyLeadService(dataSource as never);

    await expect(service.execute('lead-1', { sourceDealerId: 'dealer-source', targetDealerId: 'dealer-target' }))
      .resolves.toMatchObject({ success: true, targetDealerId: 'dealer-target' });
  });

  it('copies the existing lead relationship to the target dealer after the composite check passes', async () => {
    const runner = createRunner([
      [sourceRow],
      [{ id: 'dealer-target', name: 'Dealer Target' }],
      [],
      [],
      [],
    ]);
    const dataSource = { createQueryRunner: vi.fn(() => runner) };
    const service = new CopyLeadService(dataSource as never);
    const calls = runner.query.mock.calls as unknown[][];

    await expect(service.execute('lead-1', { sourceDealerId: 'dealer-source', targetDealerId: 'dealer-target' }))
      .resolves.toEqual({ success: true, leadId: 'lead-1', sourceDealerId: 'dealer-source', targetDealerId: 'dealer-target' });
    expect(runner.query).toHaveBeenCalledTimes(6);
    expect(calls[5]?.[0]).toContain('INSERT INTO lead_dealers');
    expect(calls[5]?.[1]).toEqual([
      'lead-1', 'dealer-target', 'Honda CR-V', '2000', 'this month', 'proof of income: yes',
      'yes', 'yes', null, 'Copied from Dealer Source', sourceRow.message_text,
    ]);
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
    expect(runner.release).toHaveBeenCalledOnce();
  });
});
