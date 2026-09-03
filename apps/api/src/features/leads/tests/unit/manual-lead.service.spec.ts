import { describe, expect, it, vi } from 'vitest';
import { ManualLeadService } from '../../application/manual-lead.service';

describe('ManualLeadService', () => {
  it('returns an already-sent result for a duplicate in the selected dealer', async () => {
    let active = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM dealers')) return [{ id: 'dealer-1', ghl_location_id: 'loc-1' }];
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM leads l')) return [{ id: 'lead-sent', first_name: 'Alonso', last_name: 'Vidal', canonical_phone: '+13019876543', status: 'sent' }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const queryRunner = {
      connect: vi.fn(async () => undefined),
      startTransaction: vi.fn(async () => { active = true; }),
      rollbackTransaction: vi.fn(async () => { active = false; }),
      commitTransaction: vi.fn(async () => { active = false; }),
      release: vi.fn(async () => undefined),
      query,
      get isTransactionActive() { return active; },
    };
    const service = new ManualLeadService({ createQueryRunner: vi.fn(() => queryRunner) } as never);

    const result = await service.execute('dealer-1', {
      name: 'Alonso Vidal',
      phone: '3019876543',
      vehicle_type: '',
      down_payment: '',
      purchase_timeline: '',
      documents: '',
      identification: '',
      bank_account: '',
    });

    expect(result).toEqual({
      success: true,
      leadId: 'lead-sent',
      message: 'El lead ya fue enviado.',
      alreadySent: true,
      leadName: 'Alonso Vidal',
      leadPhone: '+13019876543',
    });
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });
});
