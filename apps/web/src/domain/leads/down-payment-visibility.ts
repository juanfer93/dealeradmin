function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function isNoDownPayment(value: string): boolean {
  return /^(?:no\s+down(?:\s+payment)?|no\s+tengo\s+down(?:\s+payment)?|sin\s+enganche|no\s+enganche)$/i.test(value);
}

function isOffleaseDealer(value: string | null | undefined): boolean {
  const normalized = clean(value).toLocaleLowerCase();
  return new Set(['fredericksburg', 'fredericksburg-2', 'fredericksburg 2']).has(normalized)
    || /^offlease(?:\s+motors)?\s+fredericksburg(?:\s*2)?$/i.test(normalized);
}

export function visibleDownPayment(value: string | null | undefined, dealerName?: string | null): string {
  const normalized = clean(value);
  if (!normalized || isNoDownPayment(normalized)) return normalized;
  const amounts = [...normalized.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k?)\b/gi)].map((match) => match[1]);
  if (!amounts.length) return normalized;
  const isRange = /(?:-|–|—|\bto\b|\ba\b)/i.test(normalized);
  const numeric = (isRange ? amounts[amounts.length - 1] : amounts[0]).replace(/,/g, '').trim().toLowerCase();
  const hasThousandsSuffix = numeric.endsWith('k');
  const parsed = Number.parseFloat(numeric.replace(/k$/, ''));
  const amount = hasThousandsSuffix ? parsed * 1000 : parsed;
  if (!Number.isFinite(amount)) return normalized;
  const rounded = amount === 999 ? '1000' : normalized;
  const minimum = isOffleaseDealer(dealerName) ? 1500 : 1000;
  return amount === 999 ? (minimum <= 1000 ? rounded : '') : amount < minimum ? '' : normalized;
}

export function formatDownPaymentLabel(value: string | null | undefined, language: 'es' | 'en'): string {
  const normalized = clean(value);
  if (isCashDownPaymentLabel(normalized)) {
    return language === 'en' ? 'Pay in cash' : 'Pagara en cash / de contado';
  }
  return normalized;
}

export function isCashDownPaymentLabel(value: string | null | undefined): boolean {
  return /^(?:pagara en cash \/ de contado|cash|contado|de contado|efectivo|paid in full|pay in cash)$/i.test(clean(value));
}
