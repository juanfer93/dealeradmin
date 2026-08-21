import { randomUUID } from 'node:crypto';
import type { CreateManualLeadDto } from '@dealeradmin/contracts';

export type TestDealer = {
  id: string;
  code: string;
  name: string;
  pendingCount: number;
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
  { id: 'dealer-stafford', code: 'STAFFORD', name: 'Offlease Motors Stafford', pendingCount: 0 },
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
