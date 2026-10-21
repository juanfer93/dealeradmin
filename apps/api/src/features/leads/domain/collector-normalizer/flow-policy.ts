import { ADVISOR_HANDOFF_VEHICLE, EMPTY } from './constants';
import type { CollectorFlowPolicy, CollectorInput } from './types';
import { clean, firstNonEmpty } from './text-cleaner';

const CUSTOMER_LOCATION_ALIASES: ReadonlyArray<{ canonical: string; pattern: RegExp }> = [
  { canonical: 'Baltimore', pattern: /\bbaltimore\b/i },
  { canonical: 'Laurel', pattern: /\blaurel\b/i },
  { canonical: 'Sterling', pattern: /\bsterling\b/i },
  { canonical: 'Millersville', pattern: /\bmillersville\b/i },
  { canonical: 'Frederick', pattern: /\bfrederick\b/i },
  { canonical: 'Fredericksburg', pattern: /\bfredericksburg\b/i },
  { canonical: 'Woodbridge', pattern: /\bwoodbridge\b/i },
  { canonical: 'Alexandria', pattern: /\balexandria\b/i },
  { canonical: 'Culpeper', pattern: /\bculpeper\b/i },
  { canonical: 'Stafford', pattern: /\bstafford\b/i },
];
const BALTIMORE_VARIANT_PATTERN = /\b(?:baltimore|baltimor|baltmore|baltimroe|balitmore|baltimre|baltimorre|baltimoro|balitmor|baltimo|bomltimo)\b/i;

export function isAdvisorHandoffVehicle(value: string | null | undefined): boolean {
  return clean(value).toLocaleLowerCase() === ADVISOR_HANDOFF_VEHICLE.toLocaleLowerCase();
}

export function isMessengerChannel(value: string | null | undefined): boolean {
  return /(?:^|[^a-z])(?:messenger|facebook)(?:$|[^a-z])/i.test(clean(value));
}

export function isWhatsAppChannel(value: string | null | undefined): boolean {
  return /(?:^|[^a-z])whats?app(?:$|[^a-z])/i.test(clean(value));
}

export function effectiveChannel(input: CollectorInput): string {
  const channel = clean(input.channel);
  if (channel) return channel;
  const source = clean(input.source);
  return /(?:^|[^a-z])(?:messenger|facebook|whats?app)(?:$|[^a-z])/i.test(source) ? source : EMPTY;
}

export function collectorFlowPolicy(input: CollectorInput): CollectorFlowPolicy {
  const source = clean(input.source).toLocaleLowerCase();
  const sourceAware = Boolean(source);
  const stafford = source === 'stafford';
  const requiresLocation = source === 'easterns' || source === 'easterns-millersville';
  return {
    sourceAware,
    stafford,
    requiresLocation,
    phoneSatisfiedByNative: stafford && isWhatsAppChannel(input.channel),
  };
}

function canonicalCustomerLocation(value: string, allowFuzzyBaltimore: boolean): string {
  const candidate = clean(value);
  return allowFuzzyBaltimore && isBaltimoreVariant(candidate) ? 'Baltimore' : candidate;
}

function editDistanceAtMost(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let minimum = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      current[column] = value;
      minimum = Math.min(minimum, value);
    }
    if (minimum > limit) return false;
    previous = current;
  }
  return previous[right.length] <= limit;
}

export function isBaltimoreVariant(value: string): boolean {
  const candidate = clean(value).toLocaleLowerCase();
  if (BALTIMORE_VARIANT_PATTERN.test(candidate)) return true;
  return (candidate.match(/[a-z]+/g) ?? [])
    .filter((token) => token.length >= 6 && token.length <= 12 && token.startsWith('b'))
    .some((token) => editDistanceAtMost(token, 'baltimore', 3));
}

export function extractCustomerLocation(input: CollectorInput, transcript: string): string {
  const allowFuzzyBaltimore = clean(input.source).toLocaleLowerCase() === 'easterns';
  const supplied = firstNonEmpty(input.customer_location);
  if (supplied) return canonicalCustomerLocation(supplied, allowFuzzyBaltimore);
  const exactLocation = CUSTOMER_LOCATION_ALIASES.find(({ pattern }) => pattern.test(transcript))?.canonical;
  if (exactLocation) return exactLocation;
  return allowFuzzyBaltimore && isBaltimoreVariant(transcript) ? 'Baltimore' : EMPTY;
}
