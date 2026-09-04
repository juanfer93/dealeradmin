import { afterEach, describe, expect, it } from 'vitest';
import { BulkLeadService } from '../../apps/api/src/features/leads/application/bulk-lead.service';
import { getTestManualLeads, resetTestLeadStore } from '../../apps/api/src/features/leads/application/test-lead-store';

describe('bulk lead import', () => {
  afterEach(() => resetTestLeadStore());

  it('inserts new rows and reports same-dealer name plus phone duplicates', async () => {
    const service = new BulkLeadService(undefined);
    const result = await service.execute('dealer-stafford', [
      'Carlos Mendoza | +15551234567 | SUV | 2,000',
      'Lucia Gomez | 3019876548 | SUV | 2,000 | prueba de ingresos | esta semana',
    ].join('\n'));

    expect(result.summary).toEqual({ received: 2, inserted: 1, duplicates: 1, invalid: 0 });
    expect(result.rows[0].reason).toContain('Carlos Mendoza');
    expect(result.rows[0].reason).toContain('+15551234567');
    expect(result.rows[1]).toMatchObject({ name: 'Lucia Gomez', phone: '+13019876548', status: 'inserted' });
    expect(getTestManualLeads()).toHaveLength(1);
    expect(getTestManualLeads()[0].downPayment).toBe('2000');
  });

  it('allows a repeated phone in the same dealer when the name is different', async () => {
    const service = new BulkLeadService(undefined);

    const result = await service.execute('dealer-stafford', 'Otro Cliente | +15551234567 | SUV');

    expect(result.summary).toEqual({ received: 1, inserted: 1, duplicates: 0, invalid: 0 });
    expect(result.rows[0]).toMatchObject({ name: 'Otro Cliente', phone: '+15551234567', status: 'inserted' });
  });
});
