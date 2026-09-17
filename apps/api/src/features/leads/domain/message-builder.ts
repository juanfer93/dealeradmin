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
  /\b(?:solo|sólo)\s+(?:estoy\s+|est[aá]\s+|ando\s+)?(?:mirando|observando|viendo|buscando|busco|cotizando|explorando|curioseando|revisando)\b/i,
  /\b(?:estoy|est[aá]|ando)\s+(?:solo|sólo)\s+(?:mirando|observando|viendo|buscando|busco|cotizando|explorando|curioseando|revisando)\b/i,
  /\b(?:just|only)\s+(?:looking|browsing|shopping\s+around|checking|exploring)\b/i,
  /\b(?:exploring|explorando|browsing|viendo)\s+options?\b/i,
  /\b(?:quiere\s+comprar\s+)?quiere\s+ver\s+opciones\b/i,
  /\b(?:wants?\s+to\s+buy\s+)?wants?\s+to\s+see\s+options\b/i,
  /\b(?:wants?\s+to\s+buy\s+)?(?:exploring|explorando)\s+options?\b/i,
];

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isAffirmative(value: string): boolean {
  return /^(?:yes|si|sí|true|available|tengo|have it|i have|i do)$/i.test(value.trim());
}

function isNegative(value: string): boolean {
  return /^(?:no|n[oó]|false|not available|not indicated|not specified|no indicado|no especificado)$/i.test(value.trim());
}

export function formatIdentification(value: string | null | undefined): string {
  const normalized = clean(value);
  if (!normalized) return '';
  const withoutLabel = normalized.replace(/^identification\s*:\s*/i, '').trim();
  if (!withoutLabel || isNegative(withoutLabel)) return '';
  if (isAffirmative(withoutLabel) || /^(?:id|driver(?:'s)? license|license|licencia|itin|passport|pasaporte)$/i.test(withoutLabel)) return 'ID';
  return `ID: ${withoutLabel}`;
}

export function formatBankAccount(value: string | null | undefined, language: 'es' | 'en'): string {
  const normalized = clean(value);
  if (!normalized || isNegative(normalized)) return '';
  const label = language === 'es' ? 'cuenta bancaria' : 'bank account';
  return isAffirmative(normalized) || /^(?:bank account|cuenta bancaria|cuenta de banco)$/i.test(normalized) ? label : `${label} ${normalized}`;
}

export function formatDocuments(value: string | null | undefined, language: 'es' | 'en', omitIdentification = false): string {
  const normalized = clean(value);
  if (!normalized) return '';
  const chunks = normalized
    .split(/[;,]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const identification = chunk.match(/^identification\s*:\s*(.+)$/i);
      if (identification) return omitIdentification ? '' : formatIdentification(identification[1]);
      const income = chunk.match(/^(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos)\s*:\s*(.+)$/i);
      if (income) {
        if (isNegative(income[1])) return '';
        if (isAffirmative(income[1])) return language === 'es' ? 'comprobante de ingresos' : 'proof of income';
      }
      return chunk;
    })
    .filter(Boolean);
  const source = normalized.toLowerCase();
  const hasIdentification = /\b(?:id|identification|driver(?:'s)? license|license|licencia|itin|passport|pasaporte)\b/i.test(source)
    && !/(?:identification|id|license|licencia|itin|passport|pasaporte)[^;,]{0,40}\b(?:no|not|sin|false)\b/i.test(source);
  const hasIncome = /\b(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos|income|ingresos)\b/i.test(source)
    && !/(?:proof of income|income proof|prueba de ingresos|comprobante de ingresos|income|ingresos)[^;,]{0,40}\b(?:no|not|sin|false)\b/i.test(source);
  const documentLabels = [
    hasIdentification && !omitIdentification ? 'ID' : '',
    hasIncome ? (language === 'es' ? 'comprobante de ingresos' : 'proof of income') : '',
  ].filter(Boolean);
  if (documentLabels.length) return [...new Map(documentLabels.map((chunk) => [chunk.toLowerCase(), chunk])).values()].join(', ');
  return [...new Map(chunks.map((chunk) => [chunk.toLowerCase(), chunk])).values()].join(', ');
}

export function formatPurchaseTimeline(value: string | null | undefined, language: 'es' | 'en'): string {
  const normalized = normalizePurchaseTimeline(value);
  if (!normalized) return '';
  if (normalized === LOOKING_OPTIONS_LABEL) return LOOKING_OPTIONS_LABEL;
  const source = normalized
    .replace(/\b(?:quiere\s+comprar|wants?\s+to\s+buy)\b/gi, '')
    .trim()
    .toLowerCase();
  if (/^(?:today|hoy|now|ahora|asap|as soon as possible|lo m[aá]s pronto posible|lo antes posible)$/i.test(source)) {
    return language === 'es' ? 'lo más pronto posible' : 'asap';
  }
  if (/^(?:this|esta)\s+(?:week|semana)$/i.test(source)) return language === 'es' ? 'esta semana' : 'this week';
  if (/^(?:next|pr[oó]xima?|siguiente)\s+(?:week|semana)$/i.test(source)) return language === 'es' ? 'próxima semana' : 'next week';
  if (/^(?:this|este|esta)\s+(?:month|mes)$/i.test(source)) return language === 'es' ? 'este mes' : 'this month';
  if (/^(?:next|pr[oó]ximo?|siguiente)\s+(?:month|mes)$/i.test(source)) return language === 'es' ? 'próximo mes' : 'next month';
  return source;
}

export function detectMessageLanguage(data: MessageLeadData): 'es' | 'en' {
  const text = Object.values(data).filter(Boolean).join(' ').toLowerCase();
  const explicitLanguage = [
    { phrase: /\bquiere\s+comprar\b/i, language: 'es' as const },
    { phrase: /\bwants?\s+to\s+buy\b/i, language: 'en' as const },
  ]
    .map(({ phrase, language }) => ({ language, index: text.search(phrase) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index)[0];
  if (explicitLanguage) return explicitLanguage.language;

  const timeline = data.purchase_timeline?.toLowerCase() ?? '';
  if (/\b(?:solo|sólo|mirando|observando|viendo|buscando|opciones)\b/i.test(timeline)) return 'es';
  if (/\b(?:just|only|looking|browsing|shopping|exploring)\b/i.test(timeline)) return 'en';
  if (/\b(?:today|this|next|week|month|as soon as possible|asap|now)\b/i.test(timeline)) return 'en';
  if (/\b(?:hoy|esta|este|pr[oó]xima?|siguiente|semana|mes|lo m[aá]s pronto|lo antes posible|ahora)\b/i.test(timeline)) return 'es';

  const englishSignals = [' and ', 'wants', 'buy', 'week', 'proof', 'income', 'truck', 'cash', 'bank account', 'today', 'month', 'next', 'exploring'];
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
  const identification = formatIdentification(data.identification);
  const bankAccount = formatBankAccount(data.bank_account, language);
  const documents = formatDocuments(data.documents, language, Boolean(identification));
  const timelineValue = formatPurchaseTimeline(data.purchase_timeline, language);
  const timeline = timelineValue
    ? timelineValue === LOOKING_OPTIONS_LABEL
      ? language === 'es' ? timelineValue : 'wants to see options'
      : language === 'es' ? `quiere comprar ${timelineValue.toLowerCase()}` : `wants to buy ${timelineValue.toLowerCase()}`
    : '';

  const identity = [name.trim(), phone, vehicle].filter(Boolean).join(' ');
  const parts = [identity, down, identification, bankAccount, documents, timeline].filter(Boolean);
  const uniqueParts = [...new Map(parts.map((part) => [part.toLowerCase(), part])).values()];
  return uniqueParts.join(', ') + '.';
}
