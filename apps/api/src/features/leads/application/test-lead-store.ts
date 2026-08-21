import { randomUUID } from 'node:crypto';
import type { CreateManualLeadDto, LeadWebhookDto } from '@dealeradmin/contracts';
import { buildWhatsAppMessage } from '../domain/message-builder';
import { normalizePhone } from '../domain/phone-normalizer';

export type TestDealer = {
  id: string;
  code: string;
  name: string;
  pendingCount: number;
  ghlLocationId?: string;
};

export type TestLead = {
  id: string;
  dealerId: string;
  dealerName: string;
  name: string;
  phone: string;
  vehicleType: string;
  downPayment: string;
  identification: string;
  bankAccount: string;
  documents: string;
  purchaseTimeline: string;
  status: 'pending' | 'sent';
  messageText: string;
  createdAt: string;
};

export const testDealers: TestDealer[] = [
  { id: 'dealer-fredericksburg', code: 'FRED', name: 'Offlease Fredericksburg', pendingCount: 1 },
  { id: 'dealer-fredericksburg-2', code: 'FRED-2', name: 'Offlease Fredericksburg 2', pendingCount: 0 },
  { id: 'dealer-stafford', code: 'STAFFORD', name: 'Offlease Motors Stafford', pendingCount: 1, ghlLocationId: 'loc_stafford_789' },
];

export const testLead: TestLead = {
  id: 'lead-maria-lopez',
  dealerId: 'dealer-fredericksburg',
  dealerName: 'Offlease Fredericksburg',
  name: 'Maria Lopez',
  phone: '+15559876543',
  vehicleType: 'Sedan',
  downPayment: '',
  identification: '',
  bankAccount: '',
  documents: '',
  purchaseTimeline: '',
  status: 'pending',
  messageText: 'Maria Lopez +15559876543 Sedan.',
  createdAt: '2026-08-21T12:00:00.000Z',
};

export const smartMergeTestLead: TestLead = {
  id: 'lead-carlos-mendoza',
  dealerId: 'dealer-stafford',
  dealerName: 'Offlease Motors Stafford',
  name: 'Carlos Mendoza',
  phone: '+15551234567',
  vehicleType: 'Sedan',
  downPayment: '',
  identification: '',
  bankAccount: '',
  documents: '',
  purchaseTimeline: '',
  status: 'pending',
  messageText: 'Carlos Mendoza +15551234567 Sedan.',
  createdAt: '2026-08-21T12:05:00.000Z',
};

const manualTestLeads: TestLead[] = [];

export function getTestDealer(dealerId: string): TestDealer | undefined {
  return testDealers.find((dealer) => dealer.id === dealerId);
}

export function getTestManualLeads(): TestLead[] {
  return [...manualTestLeads];
}

export function addTestManualLead(
  dealerId: string,
  dto: CreateManualLeadDto,
  phone: string,
  messageText: string,
): TestLead {
  const dealer = getTestDealer(dealerId);
  if (!dealer) throw new Error('TEST_DEALER_NOT_FOUND');

  const lead: TestLead = {
    id: `lead-manual-${randomUUID()}`,
    dealerId,
    dealerName: dealer.name,
    name: dto.name.trim(),
    phone,
    vehicleType: dto.vehicle_type.trim(),
    downPayment: dto.down_payment.trim(),
    identification: dto.identification.trim(),
    bankAccount: dto.bank_account.trim(),
    documents: dto.documents.trim(),
    purchaseTimeline: dto.purchase_timeline.trim(),
    status: 'pending',
    messageText,
    createdAt: new Date().toISOString(),
  };

  manualTestLeads.push(lead);
  return lead;
}

export function updateTestLeadStatus(leadId: string, status: 'sent'): boolean {
  const lead = [testLead, smartMergeTestLead, ...manualTestLeads].find((item) => item.id === leadId);
  if (!lead || lead.status === status) return false;
  lead.status = status;
  const dealer = getTestDealer(lead.dealerId);
  if (dealer) dealer.pendingCount = Math.max(0, dealer.pendingCount - 1);
  return true;
}

export function applyTestWebhookLead(payload: LeadWebhookDto): boolean {
  const dealer = testDealers.find((item) => item.ghlLocationId === payload.ghl_location_id);
  if (!dealer) return false;

  let canonicalPhone: string;
  try {
    canonicalPhone = normalizePhone(payload.lead.phone);
  } catch {
    return false;
  }

  const lead = [testLead, smartMergeTestLead, ...manualTestLeads].find(
    (item) => item.dealerId === dealer.id && item.phone === canonicalPhone,
  );
  if (!lead) return false;

  const identification = payload.lead.identification ?? payload.lead.id_number ?? payload.lead.id ?? '';
  lead.name = payload.lead.name.trim();
  lead.phone = canonicalPhone;
  lead.vehicleType = payload.lead.vehicle_type?.trim() || '';
  lead.downPayment = payload.lead.down_payment?.trim() || '';
  lead.identification = identification.trim();
  lead.bankAccount = payload.lead.bank_account?.trim() || '';
  lead.purchaseTimeline = payload.lead.purchase_timeline?.trim() || '';
  lead.documents = payload.lead.documents?.trim() || '';
  lead.messageText = buildWhatsAppMessage(payload.lead.name, canonicalPhone, { ...payload.lead, identification });
  return true;
}
