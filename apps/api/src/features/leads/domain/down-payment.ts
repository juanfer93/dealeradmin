const CASH_PATTERNS = [
  /\bcash\b/i,
  /\bcontado\b/i,
  /\befectivo\b/i,
  /\bpaid\s+in\s+full\b/i,
  /\bpaga(?:r[aá]|r)?\s+de\s+contado\b/i,
];

export function normalizeDownPayment(value: string | null | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) return '';
  return CASH_PATTERNS.some((pattern) => pattern.test(normalized)) ? 'Cash' : normalized;
}

export function isCashDownPayment(value: string | null | undefined): boolean {
  return normalizeDownPayment(value) === 'Cash';
}
