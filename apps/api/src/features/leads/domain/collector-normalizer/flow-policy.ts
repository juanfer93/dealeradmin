import { ADVISOR_HANDOFF_VEHICLE, EMPTY } from './constants';
import type { CollectorFlowPolicy, CollectorInput } from './types';
import { clean, firstNonEmpty } from './text-cleaner';

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

export function extractCustomerLocation(input: CollectorInput, transcript: string): string {
  const supplied = firstNonEmpty(input.customer_location);
  if (supplied) return supplied;
  const match = transcript.match(/\b(Baltimore|Laurel|Sterling|Millersville|Frederick|Fredericksburg|Woodbridge|Alexandria|Culpeper|Stafford)\b/i)?.[1];
  return match ? `${match[0].toLocaleUpperCase()}${match.slice(1).toLocaleLowerCase()}` : EMPTY;
}
