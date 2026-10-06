import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isFreshTimestamp, verifyHmacSignature } from '../../presentation/hmac-signature.guard';

const secret = 'test-webhook-secret-123456';
const rawBody = Buffer.from('{"event_id":"evt-security-1"}');
const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
const nowMs = Date.parse('2026-10-06T12:00:00.000Z');

describe('HMAC webhook boundary', () => {
  it('uses the constant-time comparison for an exact signature', () => {
    expect(verifyHmacSignature(rawBody, signature, secret)).toBe(true);
  });

  it('rejects null, expired and one-character-altered signatures', () => {
    expect(verifyHmacSignature(rawBody, undefined, secret)).toBe(false);
    expect(verifyHmacSignature(rawBody, signature, secret, String(nowMs / 1000 - 301), nowMs)).toBe(false);
    const altered = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    expect(verifyHmacSignature(rawBody, altered, secret)).toBe(false);
  });

  it('accepts a fresh timestamp but rejects malformed or stale timestamps', () => {
    expect(isFreshTimestamp(String(nowMs / 1000), nowMs)).toBe(true);
    expect(isFreshTimestamp('not-a-timestamp', nowMs)).toBe(false);
    expect(isFreshTimestamp(String(nowMs / 1000 - 301), nowMs)).toBe(false);
  });
});
