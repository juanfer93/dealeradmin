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
        purchase_timeline: 'Esta semana',
        documents: 'Pasaporte e ID',
      },
    });

    expect(result).toEqual({ accepted: true, eventId: 'evt-smart-merge-1', status: 'processed' });

    const relationUpsert = queryRunner.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO lead_dealers')) as [string, unknown[]] | undefined;
    expect(relationUpsert?.[0]).toContain("status = CASE WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE EXCLUDED.status END");
    expect(relationUpsert?.[0]).toContain("routing_status = CASE WHEN lead_dealers.status = 'sent' THEN lead_dealers.routing_status ELSE EXCLUDED.routing_status END");
    expect(relationUpsert?.[1]).toEqual([
      'lead-111',
      'dealer-222',
      'Troca',
      '$3,500',
      '',
      '',
      'Esta semana',
      'Pasaporte e ID',
      '',
      'resolved',
      'sent',
      'Carlos Mendoza +15551234567 Troca, $3,500 de down, quiere comprar esta semana.',
    ]);
  });
});
