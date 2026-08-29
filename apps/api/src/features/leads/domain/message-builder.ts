export type MessageLeadData = {
  vehicle_type?: string | null;
  down_payment?: string | null;
  identification?: string | null;
  bank_account?: string | null;
  purchase_timeline?: string | null;
  documents?: string | null;
};

import { isCashDownPayment, normalizeDownPayment } from './down-payment';

export const LOOKING_OPTIONS_LABEL = 'Quiere ver opciones';

const ONLY_LOOKING_PATTERNS = [
  /\b(?:solo|sólo)\s+(?:estoy\s+|est[aá]\s+|ando\s+)?(?:mirando|viendo|buscando|busco|cotizando|explorando|curioseando|revisando)\b/i,
  /\b(?:estoy|est[aá]|ando)\s+(?:solo|sólo)\s+(?:mirando|viendo|buscando|busco|cotizando|explorando|curioseando|revisando)\b/i,
  /\b(?:just|only)\s+(?:looking|browsing|shopping\s+around|checking)\b/i,
];

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function detectMessageLanguage(data: MessageLeadData): 'es' | 'en' {
  const text = Object.values(data).filter(Boolean).join(' ').toLowerCase();
  const englishSignals = [' and ', 'wants', 'buy', 'week', 'proof', 'income', 'truck', 'cash', 'bank account', 'today', 'month', 'next'];
  const spanishSignals = ['quiere', 'comprar', 'semana', 'prueba', 'ingreso', 'camioneta', 'cuenta', 'documento', 'hoy', 'mes', 'este', 'esta'];
  const englishScore = englishSignals.filter((signal) => text.includes(signal)).length;
  const spanishScore = spanishSignals.filter((signal) => text.includes(signal)).length;
  return englishScore > spanishScore ? 'en' : 'es';
}

export function normalizePurchaseTimeline(value: string | null | undefined): string | undefined {
  const normalized = clean(value);
  if (!normalized) return undefined;
  return ONLY_LOOKING_PATTERNS.some((pattern) => pattern.test(normalized))
    ? LOOKING_OPTIONS_LABEL
    : normalized;
}

export function buildWhatsAppMessage(name: string, phone: string, data: MessageLeadData): string {
  const language = detectMessageLanguage(data);
  const vehicle = clean(data.vehicle_type) ?? '';
  const downValue = normalizeDownPayment(data.down_payment);
  const down = downValue ? (isCashDownPayment(downValue) ? (language === 'es' ? 'paga en cash' : 'cash') : `${downValue}${language === 'es' ? ' de down' : ' down'}`) : '';
  const identificationValue = clean(data.identification);
  const identification = identificationValue ? `ID ${identificationValue}` : '';
  const bankAccountValue = clean(data.bank_account);
  const bankAccount = bankAccountValue ? (language === 'es' ? `cuenta bancaria ${bankAccountValue}` : `bank account ${bankAccountValue}`) : '';
  const documentsValue = clean(data.documents);
  const documents = documentsValue ? (language === 'es' ? `documentos ${documentsValue}` : documentsValue) : '';
  const timelineValue = normalizePurchaseTimeline(data.purchase_timeline);
  const timeline = timelineValue
    ? timelineValue === LOOKING_OPTIONS_LABEL
      ? language === 'es' ? timelineValue : 'wants to see options'
      : language === 'es' ? `quiere comprar ${timelineValue.toLowerCase()}` : `wants to buy ${timelineValue.toLowerCase()}`
    : '';

  const identity = [name.trim(), phone, vehicle].filter(Boolean).join(' ');
  return [identity, down, identification, bankAccount, documents, timeline].filter(Boolean).join(', ') + '.';
}
