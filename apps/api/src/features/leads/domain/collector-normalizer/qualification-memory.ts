import { EMPTY } from './constants';
import { clean, memoryText } from './text-cleaner';

export function mergeMemory(current: string, values: Record<string, string>): string {
  const segments = memoryText(current)
    .split(';')
    .map((segment) => clean(segment).replace(/^\d+(?=(?:vehicle|vehicle[_ ]?type|down(?:[_ ]?payment)?|documents?|docs|timeline|purchase[_ ]?timeline)\b)/i, ''))
    .filter((segment) => Boolean(segment) && !/^\$?\d[\d,.]*$/.test(segment));
  for (const [key, value] of Object.entries(values)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segmentKey = segments[index].match(/^[-*•\s]*([^:=-]+)\s*[:=-]/)?.[1]?.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isAlias = normalizedKey === 'vehicle' && ['vehicle', 'vehicletype', 'vehicleinterest'].includes(segmentKey || '')
        || normalizedKey === 'downpayment' && ['downpayment', 'down', 'enganche'].includes(segmentKey || '')
        || normalizedKey === 'timeline' && ['timeline', 'purchasetimeline', 'buyingtimeline'].includes(segmentKey || '')
        || normalizedKey === 'documents' && ['documents', 'docs', 'documentos'].includes(segmentKey || '')
        || normalizedKey === 'realname' && ['realname', 'name', 'fullname', 'customername', 'contactname', 'nombrereal', 'nombre', 'nombrecompleto'].includes(segmentKey || '')
        || segmentKey === normalizedKey;
      if (isAlias) segments.splice(index, 1);
    }
    if (clean(value)) segments.push(`${key}: ${clean(value).replace(/\s*;\s*/g, ', ')}`);
  }
  return [...new Set(segments)].join('; ');
}

export function normalizeMemoryDownPayment(value: string, normalizeAmount: (amount: string) => string, tradeInIntent: RegExp): string {
  const source = clean(value);
  if (!source) return EMPTY;
  const tradeIn = tradeInIntent.test(source);
  const amount = source.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*k?|\d{1,2}\s*(?:mil|thousand)|mil(?:\s+quinientos)?|(?:un|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten)\s+mil(?:\s+(?:quinientos|five hundred))?)\b/i)?.[1];
  const normalized = amount ? normalizeAmount(amount) : normalizeAmount(source);
  if (!normalized) return tradeIn ? 'trade-in' : EMPTY;
  return tradeIn && !/trade[- ]?in/i.test(normalized) ? `${normalized} + trade-in` : normalized;
}
