import { describe, expect, it, vi } from 'vitest';
import { InvalidRealNames1710000055000 } from '../../../../database/migrations/1710000055000-InvalidRealNames';

describe('InvalidRealNames1710000055000', () => {
  it('seeds the previous invalid-name catalog into the WhatsApp database table', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new InvalidRealNames1710000055000().up({ query } as never);

    const seed = String(query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO invalid_real_names'))?.[0] ?? '');
    expect(seed).toContain("('ahorita estoy trabajando')");
    expect(seed).toContain("('estoy entre ambos')");
    expect(seed).toContain("('Samantha ede Easterns Motors')");
    expect(seed).toContain("'seeded_invalid_real_name'");
    expect(seed).toContain('ON CONFLICT (channel, normalized_value) DO NOTHING');
  });
});
