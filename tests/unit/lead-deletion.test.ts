import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeadsController } from '../../apps/api/src/features/leads/presentation/leads.controller';
import { addTestManualLead, deleteTestLead, getTestManualLeads, getTestDealer } from '../../apps/api/src/features/leads/application/test-lead-store';
import { CreateManualLeadSchema } from '../../packages/contracts/src';

function request() {
  return { cookies: { dealeradmin_session: 'valid-session' } } as never;
}

describe('borrado persistente de leads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('elimina un lead manual de la cola de prueba y de su almacenamiento', () => {
    const dealer = getTestDealer('dealer-stafford')!;
    const lead = addTestManualLead(
      dealer.id,
      CreateManualLeadSchema.parse({ name: 'Lead para borrar', phone: '3019876500' }),
      '+13019876500',
      'Lead para borrar +13019876500.',
    );

    expect(deleteTestLead(lead.id, dealer.id)).toMatchObject({ ok: true, deletedLead: true, deletedRelationship: true });
    expect(getTestManualLeads()).not.toContainEqual(expect.objectContaining({ id: lead.id }));
    expect(deleteTestLead(lead.id, dealer.id)).toMatchObject({ ok: true, deletedLead: false, deletedRelationship: false });
  });

  it('borra la relación y el lead principal dentro de una transacción', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn()
        .mockResolvedValueOnce([{ id: 'lead-1' }])
        .mockResolvedValueOnce([{ lead_id: 'lead-1' }])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'lead-1' }]),
    };
    const controller = new LeadsController(
      { createQueryRunner: () => queryRunner } as never,
      { verifySession: vi.fn().mockReturnValue(true) } as never,
    );
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(controller.delete(request(), 'lead-1', 'dealer-1')).resolves.toEqual({ success: true, deletedLead: true, deletedRelationship: true });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(queryRunner.startTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.commitTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM lead_dealers'), ['lead-1', 'dealer-1']);
    expect(queryRunner.query).toHaveBeenNthCalledWith(5, expect.stringContaining('DELETE FROM leads'), ['lead-1']);
  });

  it('mantiene el lead principal cuando todavía tiene otra relación de dealer', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn()
        .mockResolvedValueOnce([{ id: 'lead-shared' }])
        .mockResolvedValueOnce([{ lead_id: 'lead-shared' }])
        .mockResolvedValueOnce([{ count: 1 }]),
    };
    const controller = new LeadsController(
      { createQueryRunner: () => queryRunner } as never,
      { verifySession: vi.fn().mockReturnValue(true) } as never,
    );
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(controller.delete(request(), 'lead-shared', 'dealer-1')).resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: true });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(queryRunner.query).toHaveBeenCalledTimes(3);
    expect(queryRunner.commitTransaction).toHaveBeenCalledOnce();
  });
});
