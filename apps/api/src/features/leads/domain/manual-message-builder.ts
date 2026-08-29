type ManualMessageLeadData = {
  vehicle_type?: string | null;
  down_payment?: string | null;
  identification?: string | null;
  bank_account?: string | null;
  purchase_timeline?: string | null;
  documents?: string | null;
};

import { isCashDownPayment, normalizeDownPayment } from './down-payment';
import { detectMessageLanguage } from './message-builder';

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function buildManualLeadMessage(name: string, phone: string, data: ManualMessageLeadData): string {
  const language = detectMessageLanguage(data);
  const vehicle = clean(data.vehicle_type);
  const down = normalizeDownPayment(data.down_payment);
  const identification = clean(data.identification);
  const bankAccount = clean(data.bank_account);
  const timeline = clean(data.purchase_timeline);

  return [
    [name.trim(), phone].filter(Boolean).join(' '),
    vehicle,
    down ? (isCashDownPayment(down) ? (language === 'es' ? 'paga en cash' : 'cash') : `${down}${language === 'es' ? ' de down' : ' down'}`) : '',
    identification ? `ID: ${identification}` : '',
    bankAccount ? (language === 'es' ? `Cuenta: ${bankAccount}` : `Bank account: ${bankAccount}`) : '',
    data.documents?.trim() ? (language === 'es' ? `documentos: ${data.documents.trim()}` : data.documents.trim()) : '',
    timeline ? (language === 'es' ? `quiere comprar ${timeline.toLowerCase()}` : `wants to buy ${timeline.toLowerCase()}`) : '',
  ].filter(Boolean).join(', ') + '.';
}
