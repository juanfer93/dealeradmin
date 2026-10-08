const normalizePhone = (value) => {
  const source = String(value ?? '').trim();
  // A phone field may contain formatting, but a free-form message must not
  // be treated as a phone just because its prices/mileage add up to 10 digits.
  if (!/^\+?[\d\s().-]+$/.test(source)) return '';
  const digits = source.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
};
const phoneFrom = (...values) => {
  for (const value of values) {
    const direct = normalizePhone(value);
    if (direct) return direct;
    // Keep the same bounded parser as collector-normalizer.ts. This accepts
    // spoken/grouped numbers such as "704 699 07 61" without turning prices,
    // mileage, years, or IDs into phone evidence.
    const matches = String(value ?? '').match(/(?<!\d)(?:\+?1[\s().-]*)?(?:\([2-9]\d{2}\)|[2-9]\d{2})(?:[\s().-]*\d){7}(?!\d)/g) || [];
    for (const candidate of matches) {
      const normalized = normalizePhone(candidate);
      if (normalized) return normalized;
    }
  }
  return '';
};
const isPhoneOnlyLine = (value) => {
  const source = clean(value);
  const digits = source.replace(/\D/g, '');
  return (digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))
    && !/[a-záéíóúüñ]/i.test(source);
};
const isPhoneAreaCodeAmount = (value, phone) => {
  const areaCode = String(phone ?? '').match(/^\+1(\d{3})/)?.[1] || '';
  return Boolean(areaCode && clean(value).replace(/\D/g, '') === areaCode);
};
const memoryText = (value) => {
  const source = String(value ?? '').trim();
  if (!source) return '';
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : item}`).join('; ');
  } catch {}
  return source.replace(/[\r\n]+/g, '; ').replace(/(?:^|;)\s*[-*•]\s*/g, '; ').replace(/\s*\|\s*/g, '; ');
};
const normalizedMemory = memoryText(rawMemory);
const memoryValue = (aliases) => {
  const pattern = aliases.slice().sort((a, b) => b.length - a.length).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+')).join('|');
  const match = normalizedMemory.match(new RegExp(`(?:^|[^a-z])(?:${pattern})\\s*(?::|=|-|\\bis\\b|\\bare\\b)\\s*([^;]+)`, 'i'));
  return clean(match?.[1]).replace(/(trade[- ]?in)\d+$/i, '$1');
};
