type ManualMessageLeadData = {
  vehicle_type?: string | null;
  down_payment?: string | null;
  identification?: string | null;
  bank_account?: string | null;
  purchase_timeline?: string | null;
  documents?: string | null;
};

import { isCashDownPayment, normalizeDownPayment } from './down-payment';
import { LOOKING_OPTIONS_LABEL, detectMessageLanguage, formatBankAccount, formatDocuments, formatIdentification, formatPurchaseTimeline } from './message-builder';

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function buildManualLeadMessage(name: string, phone: string, data: ManualMessageLeadData): string {
  const language = detectMessageLanguage(data);
  const vehicle = clean(data.vehicle_type);
  const down = normalizeDownPayment(data.down_payment);
  const identification = formatIdentification(data.identification);
  const bankAccount = formatBankAccount(data.bank_account, language);
  const documents = formatDocuments(data.documents, language, Boolean(identification));
  const timeline = formatPurchaseTimeline(data.purchase_timeline, language);

  return [
    [name.trim(), phone].filter(Boolean).join(' '),
    vehicle,
    down ? (isCashDownPayment(down) ? (language === 'es' ? 'paga en cash' : 'cash') : `${down}${language === 'es' ? ' de down' : ' down'}`) : '',
    identification,
    bankAccount,
    documents,
    timeline
      ? timeline === LOOKING_OPTIONS_LABEL
        ? language === 'es' ? timeline : 'wants to see options'
        : language === 'es' ? `quiere comprar ${timeline.toLowerCase()}` : `wants to buy ${timeline.toLowerCase()}`
      : '',
  ].filter(Boolean).join(', ') + '.';
}
