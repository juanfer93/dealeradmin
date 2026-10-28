import { describe, expect, it, vi } from 'vitest';
import { ManualLeadService } from '../../application/manual-lead.service';

describe('ManualLeadService', () => {
  it('returns an already-sent result for a duplicate in the selected dealer', async () => {
    let active = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM dealers')) return [{ id: 'dealer-1', ghl_location_id: 'loc-1' }];
      if (sql.includes('FROM conversations c')) return [];
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

  it('does not create a second manual lead when the phone is already queued in the dealer', async () => {
    let active = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM dealers')) return [{ id: 'dealer-1', ghl_location_id: 'loc-1' }];
      if (sql.includes('FROM conversations c')) return [{
        id: 'lead-queued', first_name: 'Joel', last_name: 'Lopez', canonical_phone: '+12029043614',
        conversation_id: 'conversation-queued', conversation_status: 'queued', status: 'sent',
      }];
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
      name: 'Joel Lopez', phone: '2029043614', vehicle_type: 'Sedan', down_payment: '',
      purchase_timeline: '', documents: '', identification: '', bank_account: '',
    });

    expect(result).toMatchObject({
      success: true,
      leadId: 'lead-queued',
      alreadyQueued: true,
      message: 'El lead ya está en queued para este dealer.',
    });
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO leads'))).toBe(false);
    const queuedDuplicateQuery = query.mock.calls.find(([sql]) => String(sql).includes('FROM conversations c'))?.[0];
    expect(String(queuedDuplicateQuery)).toContain("c.qualification_snapshot->>'assigned_dealer_id' = $1::text");
    expect(String(queuedDuplicateQuery)).toContain('COALESCE(ld.assigned_dealer_id, ld.dealer_id) = $1::uuid');
  });
});
