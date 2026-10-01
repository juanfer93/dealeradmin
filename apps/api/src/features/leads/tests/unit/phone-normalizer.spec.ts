import { describe, expect, it } from 'vitest';
import { normalizePhone, normalizePhoneOrNull } from '../../domain/phone-normalizer';

describe('normalizePhone', () => {
  it.each([
    ['+1 (555) 019-2834', '+15550192834'],
    ['5550192834', '+15550192834'],
    ['  555-019-2834  ', '+15550192834'],
    ['001 555 019 2834', '+15550192834'],
    ['+57 323 333 1701', '+573233331701'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', 'not-a-phone', '555-019'])('rejects malformed input %s', (input) => {
    expect(() => normalizePhone(input)).toThrow('PHONE_INVALID');
    expect(normalizePhoneOrNull(input)).toBeNull();
  });
});
