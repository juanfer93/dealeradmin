import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyHmacSignature, verifySharedSecret } from '../../apps/api/src/features/webhooks/presentation/hmac-signature.guard';

describe('verifyHmacSignature', () => {
  const body = Buffer.from('{"event_id":"evt-1"}');
  const secret = 'test-ghl-secret-123456';

  it('accepts the exact raw-body digest', () => {
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmacSignature(body, `sha256=${signature}`, secret)).toBe(true);
  });

  it('rejects missing, malformed, and incorrect signatures', () => {
    expect(verifyHmacSignature(body, undefined, secret)).toBe(false);
    expect(verifyHmacSignature(body, 'not-a-signature', secret)).toBe(false);
    expect(verifyHmacSignature(body, '00'.repeat(32), secret)).toBe(false);
  });

  it('accepts the exact shared secret used by native GHL webhooks', () => {
    expect(verifySharedSecret(secret, secret)).toBe(true);
    expect(verifySharedSecret(`${secret} `, secret)).toBe(true);
    expect(verifySharedSecret('wrong-secret', secret)).toBe(false);
    expect(verifySharedSecret(undefined, secret)).toBe(false);
  });
});
