import { describe, expect, it, vi } from 'vitest';
import { CreateManualLeadSchema } from '../../packages/contracts/src';
import { ManualLeadService } from '../../apps/api/src/features/leads/application/manual-lead.service';
import { buildManualLeadMessage } from '../../apps/api/src/features/leads/domain/manual-message-builder';
import { normalizePhone } from '../../apps/api/src/features/leads/domain/phone-normalizer';

describe('Creación manual de leads', () => {
  it('normaliza el teléfono y omite placeholders del mensaje', () => {
    const dto = CreateManualLeadSchema.parse({
      name: 'Pedro Infante',
      phone: '3019876543',
      vehicle_type: 'Troca',
      identification: 'LIC-9900',
    });

    const phone = normalizePhone(dto.phone);
    expect(phone).toBe('+13019876543');
    expect(buildManualLeadMessage(dto.name, phone, dto)).toBe('Pedro Infante +13019876543, Troca, ID: LIC-9900.');
    expect(buildManualLeadMessage(dto.name, phone, dto)).not.toContain('no indicado');
  });

  it('persiste la relación manual dentro de una transacción y usa strings vacíos', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM dealers')) return [{ id: 'dealer-1', ghl_location_id: 'location-1' }];
        if (sql.includes('FROM leads')) return [];
        if (sql.includes('INSERT INTO leads')) return [{ id: 'lead-1' }];
        return [];
      }),
    };
    const service = new ManualLeadService({ createQueryRunner: () => queryRunner } as never);

    const result = await service.execute('dealer-1', CreateManualLeadSchema.parse({
      name: 'Pedro Infante',
      phone: '3019876543',
      vehicle_type: 'Troca',
      identification: 'LIC-9900',
    }));

    expect(result).toEqual({ success: true, leadId: 'lead-1', message: 'Lead manual agregado correctamente.' });
    expect(queryRunner.startTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.commitTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    const relationInsert = queryRunner.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO lead_dealers'));
    expect(relationInsert?.[1]).toEqual([
      'lead-1', 'dealer-1', 'Troca', '', '', '', 'LIC-9900', '', 'Pedro Infante +13019876543, Troca, ID: LIC-9900.',
    ]);
  });
});
