import { hash, parseOccurredAt } from '../conversations/conversation-webhook.helpers';
import type { SourceConfigMap, SourceKey } from '../conversations/conversation-webhook.types';
import type { GhlGuardMessage } from '../../ghl-guard.client';

export function needsConversationLookup(conversationId: string | null): boolean {
  return !conversationId?.trim() || conversationId.trim().startsWith('contact:');
}

export function sourceForLocation(sourceConfig: SourceConfigMap, locationId: string): SourceKey | undefined {
  return Object.entries(sourceConfig).find(([, config]) => config.locationId === locationId)?.[0] as SourceKey | undefined;
}

export function isConversationIdentityConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  return candidate.code === '23505'
    && (candidate.constraint === 'conversations_identity_unique'
      || String(candidate.message ?? '').includes('conversations_identity_unique'));
}

export function isRetryableGuardFailure(errorCode: string, errorMessage = ''): boolean {
  if (errorCode === 'GHL_TIMEOUT'
    || errorCode === 'GHL_NETWORK_ERROR'
    || errorCode === 'GHL_AUTH_TIMEOUT'
    || errorCode === 'GHL_RATE_LIMITED'
    || /^GHL_HTTP_5\d\d$/.test(errorCode)) return true;

  // TypeORM/pg can surface a dropped Neon connection after the GHL read has
  // completed. Treat only known transport failures as transient; permanent
  // SQL errors must still fail loudly and must not spin in a retry loop.
  return /^(QueryFailedError|Error|error)$/.test(errorCode)
    && /server conn crashed|connection terminated|connection reset|connection refused|econnreset|socket hang up|authentication.*timed out|\btimeout\b|\btimed out\b/i.test(errorMessage);
}

export function normalizeDirection(value: unknown): 'inbound' | 'outbound' | 'unknown' {
  const direction = String(value ?? '').trim().toLowerCase();
  if (direction === 'inbound') return 'inbound';
  if (direction === 'outbound') return 'outbound';
  return 'unknown';
}

export function messageBody(message: GhlGuardMessage): string {
  if (typeof message.body === 'string') return message.body.replace(/\r\n?/g, '\n').trim();
  if (message.body === undefined || message.body === null) return '';
  return JSON.stringify(message.body);
}

export function messageId(message: GhlGuardMessage): string | null {
  const value = message.id ?? message.altId;
  if (typeof value === 'string' && value.trim()) return value.trim();
  const fallback = hash(JSON.stringify({ body: message.body, direction: message.direction, dateAdded: message.dateAdded, source: message.source }));
  return `guard:${fallback}`;
}

export function latestInboundAt(messages: GhlGuardMessage[]): string | null {
  const timestamps = messages
    .filter((message) => normalizeDirection(message.direction) === 'inbound')
    .map((message) => parseOccurredAt(typeof message.dateAdded === 'string' ? message.dateAdded : undefined));
  if (timestamps.length === 0) return null;
  return timestamps.sort().at(-1) ?? null;
}
