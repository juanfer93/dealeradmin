import { describe, expect, it, beforeEach } from 'vitest';
import {
  addTestManualLead,
  copyTestLead,
  deleteTestLead,
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

  it('permite repetir la eliminación de una cola ya vacía sin cruzar dealers', () => {
    expect(deleteTestLead(testLead.id, 'dealer-stafford')).toEqual({ ok: false, reason: 'wrong_dealer' });
    expect(deleteTestLead('missing-lead', 'dealer-fredericksburg')).toEqual({ ok: true, deletedLead: false, deletedRelationship: false });
    expect(deleteTestLead(testLead.id, 'dealer-fredericksburg')).toEqual({ ok: true, deletedLead: true, deletedRelationship: true });
    expect(deleteTestLead(testLead.id, 'dealer-fredericksburg')).toEqual({ ok: true, deletedLead: false, deletedRelationship: false });
  });
});
