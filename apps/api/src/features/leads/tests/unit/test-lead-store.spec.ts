import { describe, expect, it, beforeEach } from 'vitest';
import {
  addTestManualLead,
  copyTestLead,
  resetTestLeadStore,
  testLead,
} from '../../application/test-lead-store';
import { EASTERN_DEALER_IDS } from '../../../routing/domain/services/georouting.service';

describe('Identidad de lead por dealer en fixtures', () => {
  beforeEach(() => resetTestLeadStore());

  it('bloquea el duplicado en el dealer destino pero permite el mismo lead en otro dealer', () => {
    addTestManualLead(
      'dealer-stafford',
      {
        name: testLead.name,
        phone: testLead.phone,
        vehicle_type: testLead.vehicleType,
        down_payment: testLead.downPayment,
        identification: testLead.identification,
        bank_account: testLead.bankAccount,
        documents: testLead.documents,
        purchase_timeline: testLead.purchaseTimeline,
      },
      testLead.phone,
      testLead.messageText,
    );

    expect(copyTestLead(testLead.id, 'dealer-fredericksburg', 'dealer-stafford')).toEqual({ ok: false, reason: 'duplicate' });
    expect(copyTestLead(testLead.id, 'dealer-fredericksburg', EASTERN_DEALER_IDS.rosedale)).toEqual({ ok: true });
  });
});
