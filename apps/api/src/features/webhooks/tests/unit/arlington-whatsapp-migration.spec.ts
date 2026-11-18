import { describe, expect, it, vi } from 'vitest';
import { EnableArlingtonWhatsApp1710000058000 } from '../../../../database/migrations/1710000058000-EnableArlingtonWhatsApp';

describe('EnableArlingtonWhatsApp migration', () => {
  it('enables WhatsApp while retaining Messenger for Arlington Woodbridge', async () => {
    const query = vi.fn();
    const migration = new EnableArlingtonWhatsApp1710000058000();

    await migration.up({ query } as never);

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('{"channels":["messenger","whatsapp"]}');
    expect(query.mock.calls[0]?.[0]).toContain("WHERE code = 'ARL-WOOD'");
    expect(query.mock.calls[0]?.[0]).toContain("ghl_location_id = '9v8zH9Y5eLiiJwZTZDci'");
  });

  it('restores Messenger-only routing when reverted', async () => {
    const query = vi.fn();
    const migration = new EnableArlingtonWhatsApp1710000058000();

    await migration.down({ query } as never);

    expect(query.mock.calls[0]?.[0]).toContain('{"channels":["messenger"]}');
    expect(query.mock.calls[0]?.[0]).toContain("WHERE code = 'ARL-WOOD'");
  });
});
