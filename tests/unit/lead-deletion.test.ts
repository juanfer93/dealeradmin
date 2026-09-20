import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeadsController } from '../../apps/api/src/features/leads/presentation/leads.controller';
import { addTestManualLead, deleteTestLead, getTestManualLeads, getTestDealer, updateTestLeadStatus } from '../../apps/api/src/features/leads/application/test-lead-store';
import { CreateManualLeadSchema } from '../../packages/contracts/src';

function request() {
  return { cookies: { dealeradmin_session: 'valid-session' } } as never;
}

describe('retiro de relaciones sin borrar leads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retira un lead manual de la cola de prueba y conserva su historial', () => {
    const dealer = getTestDealer('dealer-stafford')!;
    const lead = addTestManualLead(
      dealer.id,
      CreateManualLeadSchema.parse({ name: 'Lead para borrar', phone: '3019876500' }),
      '+13019876500',
      'Lead para borrar +13019876500.',
    );

    expect(deleteTestLead(lead.id, dealer.id)).toMatchObject({ ok: true, deletedLead: false, deletedRelationship: true });
    expect(getTestManualLeads()).toContainEqual(expect.objectContaining({ id: lead.id }));
    expect(deleteTestLead(lead.id, dealer.id)).toMatchObject({ ok: true, deletedLead: false, deletedRelationship: false });
  });

  it('no elimina un lead que ya fue marcado como enviado', () => {
    const dealer = getTestDealer('dealer-stafford')!;
    const lead = addTestManualLead(
      dealer.id,
      CreateManualLeadSchema.parse({ name: 'Lead enviado protegido', phone: '3019876501' }),
      '+13019876501',
      'Lead enviado protegido +13019876501.',
    );

    expect(updateTestLeadStatus(lead.id, 'sent')).toBe(true);
    expect(deleteTestLead(lead.id, dealer.id)).toEqual({ ok: true, deletedLead: false, deletedRelationship: false });
    expect(getTestManualLeads()).toContainEqual(expect.objectContaining({ id: lead.id, status: 'sent' }));
  });

  it('borra solo la relación dentro de una transacción y conserva el lead principal', async () => {
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
        .mockResolvedValueOnce([]),
    };
    const controller = new LeadsController(
      { createQueryRunner: () => queryRunner } as never,
      { verifySession: vi.fn().mockReturnValue(true) } as never,
    );
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(controller.delete(request(), 'lead-1', 'dealer-1')).resolves.toEqual({ success: true, deletedLead: false, deletedRelationship: true });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(queryRunner.startTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.commitTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM lead_dealers'), ['lead-1', 'dealer-1']);
    expect(queryRunner.query).toHaveBeenCalledTimes(2);
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

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    expect(queryRunner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('elimina varios leads seleccionados desde la cola de prueba', async () => {
    const dealer = getTestDealer('dealer-stafford')!;
    const first = addTestManualLead(
      dealer.id,
      CreateManualLeadSchema.parse({ name: 'Lead masivo uno', phone: '3019876502' }),
      '+13019876502',
      'Lead masivo uno +13019876502.',
    );
    const second = addTestManualLead(
      dealer.id,
      CreateManualLeadSchema.parse({ name: 'Lead masivo dos', phone: '3019876503' }),
      '+13019876503',
      'Lead masivo dos +13019876503.',
    );
    const controller = new LeadsController(
      undefined,
      { verifySession: vi.fn().mockReturnValue(true) } as never,
    );
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    try {
      await expect(controller.deleteSelected(request(), {
        items: [
          { leadId: first.id, dealerId: dealer.id },
          { leadId: second.id, dealerId: dealer.id },
        ],
      })).resolves.toMatchObject({
        success: true,
        requestedCount: 2,
        deletedLeadCount: 0,
        deletedRelationshipCount: 2,
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(getTestManualLeads()).toEqual(expect.arrayContaining([first, second]));
  });
});
