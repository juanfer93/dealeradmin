import { EMPTY } from './constants';

export function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? EMPTY;
}

export function isEmptyMarker(value: string): boolean {
  return /^(?:--|-|n\/?a|not indicated|not specified|no indicado|no especificado)$/i.test(value.trim());
}

export function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.map(clean).find((value) => Boolean(value) && !isEmptyMarker(value)) ?? EMPTY;
}

export function conversationalEvidence(...values: Array<string | null | undefined>): string {
  return values
    .flatMap((value) => String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes('?') && !/^\s*(?:do you|does|did|what|which|when|where|how|can you|are you|tienes|tiene|cu[aá]l|qu[eé]|cu[aá]ndo|d[oó]nde|c[oó]mo)\b/i.test(line))
    .join('; ');
}

export function memoryText(memory: string): string {
  const normalized = memory.trim();
  if (!normalized) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(normalized);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
        .join('; ');
    }
  } catch {
    // Qualification memory is commonly plain text; keep parsing that format.
  }
  return normalized
    .replace(/[\r\n]+/g, '; ')
    .replace(/(?:^|;)\s*[-*•]\s*/g, '; ')
    .replace(/\s*\|\s*/g, '; ');
}

export function memoryValue(memory: string, aliases: string[]): string {
  const normalized = memoryText(memory);
  if (!normalized) return EMPTY;
  const escapedAliases = [...aliases]
    .sort((left, right) => right.length - left.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+'))
    .join('|');
  const match = normalized.match(new RegExp(`(?:^|[^a-z])(?:${escapedAliases})\\s*(?::|=|-|\\bis\\b|\\bare\\b)\\s*([^;]+)`, 'i'));
  return clean(match?.[1]).replace(/(trade[- ]?in)\d+$/i, '$1');
}

export function lastMeaningfulLine(value: string): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').split(/\n+/).map(clean).filter(Boolean).at(-1) ?? EMPTY;
}
