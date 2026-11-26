import { describe, expect, it, vi } from 'vitest';
import { InvalidRealNames1710000055000 } from '../../../../database/migrations/1710000055000-InvalidRealNames';
import { MessengerInvalidRealNames1710000057000 } from '../../../../database/migrations/1710000057000-MessengerInvalidRealNames';
import { WhatsAppUnverifiedSergioProfile1710000060000 } from '../../../../database/migrations/1710000060000-WhatsAppUnverifiedSergioProfile';
import { InvalidWhatsAppProfileNames1710000061000 } from '../../../../database/migrations/1710000061000-InvalidWhatsAppProfileNames';

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

describe('MessengerInvalidRealNames1710000057000', () => {
  it('adds Messenger as a separate invalid-name catalog channel', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new MessengerInvalidRealNames1710000057000().up({ query } as never);

    expect(query).toHaveBeenNthCalledWith(1, 'ALTER TABLE invalid_real_names DROP CONSTRAINT IF EXISTS invalid_real_names_channel_valid');
    expect(String(query.mock.calls[1][0])).toContain("CHECK (channel IN ('all', 'whatsapp', 'messenger'))");
  });
});

describe('WhatsAppUnverifiedSergioProfile1710000060000', () => {
  it('seeds the unverified profile name and work-status false positive in WhatsApp only', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new WhatsAppUnverifiedSergioProfile1710000060000().up({ query } as never);

    const seed = String(query.mock.calls[0]?.[0] ?? '');
    expect(seed).toContain("('whatsapp', 'sergio echeverri', 'Sergio Echeverri', 'unverified_whatsapp_profile')");
    expect(seed).toContain("('whatsapp', 'en mi trabajo', 'En Mi Trabajo', 'whatsapp_work_status_not_name')");
    expect(seed).toContain('ON CONFLICT (channel, normalized_value) DO NOTHING');
  });
});

describe('InvalidWhatsAppProfileNames1710000061000', () => {
  it('adds Buco and the standalone greeting Buenas to the WhatsApp invalid-name catalog', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new InvalidWhatsAppProfileNames1710000061000().up({ query } as never);

    const seed = String(query.mock.calls[0]?.[0] ?? '');
    expect(seed).toContain("('whatsapp', 'buco', 'Buco', 'unverified_whatsapp_profile')");
    expect(seed).toContain("('whatsapp', 'buenas', 'Buenas', 'whatsapp_greeting_not_name')");
    expect(seed).toContain('ON CONFLICT (channel, normalized_value) DO NOTHING');
  });
});
