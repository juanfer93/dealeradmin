import { randomUUID } from 'node:crypto';
import type { CreateManualLeadDto, LeadWebhookDto } from '@dealeradmin/contracts';
import { buildWhatsAppMessage, normalizePurchaseTimeline } from '../domain/message-builder';
import { normalizePhone } from '../domain/phone-normalizer';
import { normalizeDownPayment } from '../domain/down-payment';
import { EASTERN_DEALER_IDS } from '../../routing/domain/services/georouting.service';

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

export const OFFLEASE_FREDERICKSBURG_LOCATION_IDS = {
  primary: 'MyxWNKacThim798E8KC6',
  alias: 'bAuMEQeH48xAtu9tAMFf',
} as const;

const TEST_DEALER_ALIASES: Record<string, string> = {
  'dealer-fredericksburg-2': 'dealer-fredericksburg',
};

export const testDealers: TestDealer[] = [
  { id: 'dealer-fredericksburg', code: 'FRED', name: 'Offlease Fredericksburg', pendingCount: 1, ghlLocationId: OFFLEASE_FREDERICKSBURG_LOCATION_IDS.primary },
  { id: 'dealer-stafford', code: 'STAFFORD', name: 'Offlease Motors Stafford', pendingCount: 1, ghlLocationId: 'loc_stafford_789' },
  { id: EASTERN_DEALER_IDS.rosedale, code: 'DLR-EAST-ROSE', name: 'Easterns Rosedale', pendingCount: 0 },
  { id: EASTERN_DEALER_IDS.laurel, code: 'DLR-EAST-LAUR', name: 'Easterns Laurel', pendingCount: 1 },
  { id: EASTERN_DEALER_IDS.sterling, code: 'DLR-EAST-STER', name: 'Easterns Sterling', pendingCount: 0 },
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

export const easternsTestLead: TestLead = {
  id: 'lead-easterns-andres',
  dealerId: EASTERN_DEALER_IDS.laurel,
  dealerName: 'Easterns Laurel',
  name: 'Andres Felipe',
  phone: '+15550001111',
  vehicleType: 'SUV',
  downPayment: 'Cash',
  identification: '',
  bankAccount: '',
  documents: '',
  purchaseTimeline: '',
  status: 'pending',
  messageText: 'Andres Felipe +15550001111 SUV, paga en cash.',
  createdAt: '2026-08-24T15:00:00.000Z',
};

const manualTestLeads: TestLead[] = [];
const deletedTestLeadIds = new Set<string>();

const initialTestDealers = testDealers.map((dealer) => ({ ...dealer }));
const initialTestLeads = [testLead, smartMergeTestLead, easternsTestLead].map((lead) => ({ ...lead }));

export function resetTestLeadStore(): void {
  testDealers.forEach((dealer, index) => Object.assign(dealer, initialTestDealers[index]));
  [testLead, smartMergeTestLead, easternsTestLead].forEach((lead, index) => Object.assign(lead, initialTestLeads[index]));
  manualTestLeads.splice(0, manualTestLeads.length);
  deletedTestLeadIds.clear();
}

export function getTestDealer(dealerId: string): TestDealer | undefined {
  return testDealers.find((dealer) => dealer.id === (TEST_DEALER_ALIASES[dealerId] ?? dealerId));
}

export function getTestManualLeads(): TestLead[] {
  return [...manualTestLeads];
}

export function hasTestDealerLeadDuplicate(dealerId: string, name: string, phone: string): boolean {
  const canonicalDealerId = TEST_DEALER_ALIASES[dealerId] ?? dealerId;
  const normalizedName = name.trim().toLowerCase();
  return [testLead, smartMergeTestLead, easternsTestLead, ...manualTestLeads].some(
    (lead) => !isTestLeadDeleted(lead.id)
      && lead.dealerId === canonicalDealerId
      && lead.phone === phone
      && lead.name.trim().toLowerCase() === normalizedName,
  );
}

export function isTestLeadDeleted(leadId: string): boolean {
  return deletedTestLeadIds.has(leadId);
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
    dealerId: dealer.id,
    dealerName: dealer.name,
    name: dto.name.trim(),
    phone,
    vehicleType: dto.vehicle_type.trim(),
    downPayment: normalizeDownPayment(dto.down_payment),
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
  const lead = [testLead, smartMergeTestLead, easternsTestLead, ...manualTestLeads].find((item) => item.id === leadId && !isTestLeadDeleted(item.id));
  if (!lead || lead.status === status) return false;
  lead.status = status;
  const dealer = getTestDealer(lead.dealerId);
  if (dealer) dealer.pendingCount = Math.max(0, dealer.pendingCount - 1);
  return true;
}

export function deleteTestLead(leadId: string, dealerId: string): boolean {
  const canonicalDealerId = TEST_DEALER_ALIASES[dealerId] ?? dealerId;
  const lead = [testLead, smartMergeTestLead, easternsTestLead, ...manualTestLeads].find(
    (item) => item.id === leadId && !isTestLeadDeleted(item.id),
  );
  if (!lead || lead.dealerId !== canonicalDealerId) return false;

  deletedTestLeadIds.add(leadId);
  const manualIndex = manualTestLeads.findIndex((item) => item.id === leadId);
  if (manualIndex >= 0) manualTestLeads.splice(manualIndex, 1);
  if (lead.status === 'pending') {
    const dealer = getTestDealer(canonicalDealerId);
    if (dealer) dealer.pendingCount = Math.max(0, dealer.pendingCount - 1);
  }
  return true;
}

export function reassignTestLead(leadId: string, currentDealerId: string, targetDealerId: string): boolean {
  const lead = [testLead, smartMergeTestLead, easternsTestLead, ...manualTestLeads].find((item) => item.id === leadId);
  const targetDealer = getTestDealer(targetDealerId);
  if (!lead || lead.status !== 'pending' || lead.dealerId !== currentDealerId || !targetDealer || currentDealerId === targetDealerId) {
    return false;
  }
  const currentDealer = getTestDealer(currentDealerId);
  if (currentDealer) currentDealer.pendingCount = Math.max(0, currentDealer.pendingCount - 1);
  targetDealer.pendingCount += 1;
  lead.dealerId = targetDealer.id;
  lead.dealerName = targetDealer.name;
  return true;
}

export type TestCopyLeadResult = { ok: true } | { ok: false; reason: 'not_found' | 'duplicate' };

export function copyTestLead(leadId: string, sourceDealerId: string, targetDealerId: string): TestCopyLeadResult {
  const source = [testLead, smartMergeTestLead, easternsTestLead, ...manualTestLeads].find(
    (item) => item.id === leadId && !isTestLeadDeleted(item.id) && item.dealerId === sourceDealerId,
  );
  const targetDealer = getTestDealer(targetDealerId);
  if (!source || !targetDealer || sourceDealerId === targetDealer.id) return { ok: false, reason: 'not_found' };

  const duplicate = [testLead, smartMergeTestLead, easternsTestLead, ...manualTestLeads].some(
    (item) => item.id !== source.id
      && !isTestLeadDeleted(item.id)
      && item.name.trim().toLowerCase() === source.name.trim().toLowerCase()
      && item.phone === source.phone,
  );
  if (duplicate) return { ok: false, reason: 'duplicate' };

  const copiedLead: TestLead = {
    ...source,
    id: `${source.id}-copy-${targetDealer.id}`,
    dealerId: targetDealer.id,
    dealerName: targetDealer.name,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  manualTestLeads.push(copiedLead);
  targetDealer.pendingCount += 1;
  return { ok: true };
}

export function applyTestWebhookLead(payload: LeadWebhookDto): boolean {
  const dealer = testDealers.find(
    (item) => item.ghlLocationId === payload.ghl_location_id
      || (item.id === 'dealer-fredericksburg' && payload.ghl_location_id === OFFLEASE_FREDERICKSBURG_LOCATION_IDS.alias),
  );
  if (!dealer) return false;

  let canonicalPhone: string;
  try {
    canonicalPhone = normalizePhone(payload.lead.phone);
  } catch {
    return false;
  }

  const lead = [testLead, smartMergeTestLead, ...manualTestLeads].find(
    (item) => !isTestLeadDeleted(item.id) && item.dealerId === dealer.id && item.phone === canonicalPhone,
  );
  if (!lead) return false;

  const identification = payload.lead.identification ?? payload.lead.id_number ?? payload.lead.id ?? '';
  lead.name = payload.lead.name.trim();
  lead.phone = canonicalPhone;
  lead.vehicleType = payload.lead.vehicle_type?.trim() || '';
  lead.downPayment = normalizeDownPayment(payload.lead.down_payment);
  lead.identification = identification.trim();
  lead.bankAccount = payload.lead.bank_account?.trim() || '';
  lead.purchaseTimeline = normalizePurchaseTimeline(payload.lead.purchase_timeline) || '';
  lead.documents = payload.lead.documents?.trim() || '';
  lead.messageText = buildWhatsAppMessage(payload.lead.name, canonicalPhone, { ...payload.lead, identification });
  return true;
}
