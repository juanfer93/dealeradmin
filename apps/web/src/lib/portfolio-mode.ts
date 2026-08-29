export const isPortfolioMode = process.env.NEXT_PUBLIC_SITE_MODE === 'portfolio';

export const portfolioWriteBlockedMessage =
  'Modo demostración: esta acción está deshabilitada para proteger los datos de producción.';

export type PortfolioDealer = {
  id: string;
  code: string;
  name: string;
  pendingCount: number;
};

export type PortfolioLead = {
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

export const portfolioDealers: PortfolioDealer[] = [
  { id: 'portfolio-stafford', code: 'STAFFORD', name: 'Stafford demo queue', pendingCount: 2 },
  { id: 'portfolio-fredericksburg', code: 'FRED', name: 'Fredericksburg demo queue', pendingCount: 1 },
  { id: 'portfolio-easterns', code: 'EASTERN', name: 'Easterns demo queue', pendingCount: 0 },
];

const portfolioLeads: PortfolioLead[] = [
  {
    id: 'portfolio-lead-01',
    dealerId: 'portfolio-stafford',
    dealerName: 'Stafford demo queue',
    name: 'Jordan Sample',
    phone: '+15550101001',
    vehicleType: 'Compact SUV',
    downPayment: '$1,500',
    identification: 'Demo ID',
    bankAccount: '',
    documents: 'Proof of income',
    purchaseTimeline: 'this week',
    status: 'pending',
    messageText: 'Jordan Sample +15550101001 truck, $1,500 down, ID Demo ID, Proof of income, wants to buy this week.',
    createdAt: '2026-08-29T12:10:00.000Z',
  },
  {
    id: 'portfolio-lead-02',
    dealerId: 'portfolio-stafford',
    dealerName: 'Stafford demo queue',
    name: 'Taylor Example',
    phone: '+15550101002',
    vehicleType: 'Sedan',
    downPayment: 'Cash',
    identification: '',
    bankAccount: '',
    documents: '',
    purchaseTimeline: 'next month',
    status: 'pending',
    messageText: 'Taylor Example +15550101002 Sedan, Cash de down, quiere comprar next month.',
    createdAt: '2026-08-29T11:48:00.000Z',
  },
  {
    id: 'portfolio-lead-03',
    dealerId: 'portfolio-fredericksburg',
    dealerName: 'Fredericksburg demo queue',
    name: 'Alex Placeholder',
    phone: '+15550101003',
    vehicleType: 'Pickup',
    downPayment: '',
    identification: '',
    bankAccount: '',
    documents: 'Driver license',
    purchaseTimeline: 'today',
    status: 'pending',
    messageText: 'Alex Placeholder +15550101003 Pickup, quiere comprar today.',
    createdAt: '2026-08-29T11:22:00.000Z',
  },
  {
    id: 'portfolio-lead-04',
    dealerId: 'portfolio-easterns',
    dealerName: 'Easterns demo queue',
    name: 'Morgan Test',
    phone: '+15550101004',
    vehicleType: 'Hatchback',
    downPayment: '$2,000',
    identification: 'Demo ID',
    bankAccount: '',
    documents: '',
    purchaseTimeline: 'this month',
    status: 'sent',
    messageText: 'Morgan Test +15550101004 Hatchback, $2,000 de down, ID Demo ID, quiere comprar this month.',
    createdAt: '2026-08-28T16:42:00.000Z',
  },
];

export function getPortfolioLeadResponse(
  status: 'pending' | 'sent',
  dealerId?: string,
  dealerIds?: string[],
): { dealers: PortfolioDealer[]; leads: PortfolioLead[] } {
  const selectedDealerIds = dealerIds?.length ? dealerIds : dealerId ? [dealerId] : undefined;
  const leads = portfolioLeads.filter((lead) =>
    lead.status === status && (!selectedDealerIds || selectedDealerIds.includes(lead.dealerId)),
  );

  return { dealers: portfolioDealers, leads };
}
