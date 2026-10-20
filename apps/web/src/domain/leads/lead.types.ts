export type LeadStatus = 'pending' | 'wrote_again' | 'sent';

export type Dealer = {
  id: string;
  code: string;
  name: string;
  pendingCount: number;
};

export type Lead = {
  id: string;
  dealerId: string;
  dealerName: string;
  name: string;
  phone: string;
  vehicleType: string | null;
  downPayment: string | null;
  vehicleCategory?: string | null;
  requiredDownPayment?: number | null;
  downPaymentAmount?: number | null;
  previousFinancing?: 'yes' | 'no' | '' | null;
  downPaymentSufficient?: boolean | null;
  qualificationStep?: string | null;
  identification: string | null;
  bankAccount: string | null;
  documents: string | null;
  purchaseTimeline: string | null;
  reengagementCount?: number | null;
  status: LeadStatus;
  messageText: string;
  createdAt: string;
};

export type LeadResponse = {
  dealers: Dealer[];
  leads: Lead[];
  wroteAgainCount?: number;
};
