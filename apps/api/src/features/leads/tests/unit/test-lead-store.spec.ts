import { describe, expect, it, beforeEach } from 'vitest';
import {
  addTestManualLead,
  copyTestLead,
  deleteTestLead,
  resetTestLeadStore,
  testLead,
  smartMergeTestLead,
  updateTestLead,
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

  it('edita los datos del lead dentro de su dealer y regenera el mensaje', () => {
    const result = updateTestLead(testLead.id, testLead.dealerId, {
      name: 'Maria Lopez Corregida',
      phone: '3011234567',
      vehicle_type: 'Honda Civic',
      down_payment: '$1,500',
      identification: 'yes',
      bank_account: 'yes',
      documents: 'proof of income',
      purchase_timeline: 'this week',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lead).toMatchObject({
        name: 'Maria Lopez Corregida',
        phone: '+13011234567',
        vehicleType: 'Honda Civic',
        downPayment: '$1,500',
      });
      expect(result.lead.messageText).toContain('Honda Civic');
      expect(result.lead.messageText).toContain('$1,500');
    }
  });

  it('no bloquea una edición por el mismo número existente en otro dealer', () => {
    const result = updateTestLead(testLead.id, testLead.dealerId, {
      name: 'Maria Lopez',
      phone: smartMergeTestLead.phone,
      vehicle_type: 'Sedan',
      down_payment: '',
      identification: '',
      bank_account: '',
      documents: '',
      purchase_timeline: '',
    });

    expect(result.ok).toBe(true);
  });
});
