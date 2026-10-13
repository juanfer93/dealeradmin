import { describe, expect, it, vi } from 'vitest';
import { DealerLeadsController } from '../../presentation/dealer-leads.controller';

describe('DealerLeadsController', () => {
  it('does not include reengagement rows in dealer pending counts', async () => {
    const query = vi.fn(async () => []);
    const controller = new DealerLeadsController(
      {} as never,
      {} as never,
      { verifySession: vi.fn(() => true) } as never,
      { query } as never,
    );
    const previousDatabaseMode = process.env.E2E_USE_DATABASE;
    process.env.E2E_USE_DATABASE = 'true';
    try {
      await controller.listDealers({ cookies: { dealeradmin_session: 'test-session' } } as never);
    } finally {
      if (previousDatabaseMode === undefined) delete process.env.E2E_USE_DATABASE;
      else process.env.E2E_USE_DATABASE = previousDatabaseMode;
    }

    expect(query).toHaveBeenCalledTimes(1);
    expect(String((query.mock.calls as unknown[][])[0]?.[0])).toContain('NOT COALESCE(ld.has_unhandled_reengagement, false)');
  });
});
