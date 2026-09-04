import { describe, expect, it, vi } from 'vitest';
import { WebhookService } from '../../application/webhook.service';

describe('Protección contra re-procesamiento (Smart Merge)', () => {
  it('actualiza la cualificación y conserva sent para una relación ya despachada', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-smart-merge-1' }];
        if (sql.includes('FROM dealers')) return [{ id: 'dealer-222' }];
        if (sql.includes('FROM leads')) return [{ id: 'lead-111' }];
        if (sql.includes('SELECT status, routing_status')) return [{ status: 'sent', routing_status: 'resolved' }];
        return [];
      }),
    };
    const service = new WebhookService({ createQueryRunner: () => queryRunner } as never);

    const result = await service.acceptLead({
      event_id: 'evt-smart-merge-1',
      event_type: 'lead.ready_for_whatsapp',
      occurred_at: '2026-08-21T12:00:00.000Z',
      dealer_id: 'DLR-STAFF-001',
      dealer_name: 'Offlease Motors Stafford',
      ghl_location_id: 'loc_stafford_789',
      ghl_contact_id: 'ghl-contact-111',
      lead: {
        name: 'Carlos Mendoza',
        phone: '+15551234567',
        vehicle_type: 'Troca',
        down_payment: '$3,500',
        purchase_timeline: 'Solo estoy mirando',
        documents: 'Pasaporte e ID',
      },
    });

    expect(result).toEqual({ accepted: true, eventId: 'evt-smart-merge-1', status: 'processed' });

    const leadLookup = queryRunner.query.mock.calls.find(([sql]) => sql.includes('FROM leads') && sql.includes('scoped_ld')) as [string, unknown[]] | undefined;
    expect(leadLookup?.[0]).toContain('COALESCE(scoped_ld.assigned_dealer_id, scoped_ld.dealer_id) = $5');
    expect(leadLookup?.[1]).toEqual(['+15551234567', 'carlos mendoza', 'ghl-contact-111', 'loc_stafford_789', 'dealer-222']);

    const relationUpsert = queryRunner.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO lead_dealers')) as [string, unknown[]] | undefined;
    const scopedRelationLookup = queryRunner.query.mock.calls.find(([sql]) => sql.includes('SELECT status, routing_status')) as [string, unknown[]] | undefined;
    expect(scopedRelationLookup?.[0]).toContain('WHERE lead_id = $1 AND dealer_id = $2');
    expect(scopedRelationLookup?.[1]).toEqual(['lead-111', 'dealer-222']);
    expect(relationUpsert?.[0]).toContain("status = CASE WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE EXCLUDED.status END");
    expect(relationUpsert?.[0]).toContain("routing_status = CASE WHEN lead_dealers.status = 'sent' THEN lead_dealers.routing_status ELSE EXCLUDED.routing_status END");
    expect(relationUpsert?.[1]).toEqual([
      'lead-111',
      'dealer-222',
      'Troca',
      '3500',
      '',
      '',
      'exploring options',
      'Pasaporte e ID',
      '',
      'dealer-222',
      false,
      'Source dealer from GHL location',
      'resolved',
      'sent',
      'Carlos Mendoza +15551234567 Troca, 3500 de down, documentos Pasaporte e ID, quiere comprar exploring options.',
    ]);
  });

  it('toma la cuenta GHL como origen único y no deja que dealer_name cambie la ruta', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-fred-location' }];
        if (sql.includes('FROM dealers')) return [{ id: 'dealer-fred', routing_config: {} }];
        if (sql.includes('FROM leads') && sql.includes('scoped_ld')) return [];
        if (sql.includes('INSERT INTO leads')) return [{ id: 'lead-fred' }];
        return [];
      }),
    };
    const resolveDealer = vi.fn(async () => ({ dealerId: 'dealer-laurel', reason: 'must not be used' }));
    const dataSource = { createQueryRunner: () => queryRunner, query: vi.fn() } as never;
    const service = new WebhookService(dataSource, { resolveDealer } as never);

    await service.acceptLead({
      event_id: 'evt-fred-location',
      event_type: 'lead.ready_for_whatsapp',
      occurred_at: '2026-09-04T23:00:00.000Z',
      dealer_id: 'EASTERNS-LAUREL',
      dealer_name: 'Easterns Laurel',
      ghl_location_id: 'ghl-fredericksburg-location',
      ghl_contact_id: 'ghl-fred-contact',
      lead: { name: 'Emil Gonzales', phone: '+18045042746', vehicle_type: 'Troca' },
    });

    expect(resolveDealer).not.toHaveBeenCalled();
    const relationUpsert = queryRunner.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO lead_dealers')) as [string, unknown[]] | undefined;
    expect(relationUpsert?.[1]?.[1]).toBe('dealer-fred');
    expect(relationUpsert?.[1]).not.toContain('dealer-laurel');
  });

  it('rechaza un Location ID ambiguo en vez de enviarlo a un dealer arbitrario', async () => {
    const queryRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO webhook_events') && sql.includes('RETURNING')) return [{ event_id: 'evt-ambiguous-location' }];
        if (sql.includes('FROM dealers')) return [
          { id: 'dealer-fred', routing_config: {} },
          { id: 'dealer-laurel', routing_config: { group: 'Easterns' } },
        ];
        return [];
      }),
    };
    const dataSource = { createQueryRunner: () => queryRunner, query: vi.fn() } as never;
    const service = new WebhookService(dataSource);

    await expect(service.acceptLead({
      event_id: 'evt-ambiguous-location',
      event_type: 'lead.ready_for_whatsapp',
      occurred_at: '2026-09-04T23:00:00.000Z',
      dealer_id: 'UNKNOWN',
      dealer_name: 'Unknown',
      ghl_location_id: 'ghl-ambiguous-location',
      ghl_contact_id: 'ghl-ambiguous-contact',
      lead: { name: 'Lead Ambiguo', phone: '+18045040000' },
    })).rejects.toThrow('más de un dealer activo');

    expect(queryRunner.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO lead_dealers'))).toBe(false);
  });
});
