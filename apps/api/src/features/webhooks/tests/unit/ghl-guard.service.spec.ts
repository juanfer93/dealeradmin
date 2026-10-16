import { afterEach, describe, expect, it, vi } from 'vitest';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversation-webhook.config';
import { GhlGuardService } from '../../application/ghl-guard.service';

describe('GhlGuardService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not call GHL or the database when disabled', async () => {
    process.env.NODE_ENV = 'test';
    process.env.GHL_GUARD_ENABLED = 'false';
    const dataSource = { createQueryRunner: vi.fn(), query: vi.fn() } as never;
    const service = new GhlGuardService(dataSource, { reconcileConversation: vi.fn() } as never);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'));

    expect(result).toEqual({ enabled: false, skipped: true, selected: 0, fetched: 0, inserted: 0, repaired: 0, failed: 0 });
    expect((dataSource as { createQueryRunner: ReturnType<typeof vi.fn> }).createQueryRunner).not.toHaveBeenCalled();
  });

  it('fetches, persists, reconciles, and logs a local conversation', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_INTERVAL_MS = '1';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-1',
      ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-1',
      ghl_conversation_id: 'ghl-conversation-1',
      status: 'waiting_window',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
        if (sql.includes('FROM conversations')) return [row];
        return [];
      }),
      release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      isTransactionActive: true,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) return [{ id: row.id, status: row.status }];
        if (sql.includes('INSERT INTO conversation_messages')) return [{ id: 'message-1' }];
        return [];
      }),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(lockRunner)
        .mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_logs') ? [{ id: 'guard-log-1' }] : []),
    };
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        requestPath: '/conversations/ghl-conversation-1/messages',
        data: { messages: [{ id: 'message-1', body: 'Busco una troca', direction: 'inbound', dateAdded: '2026-10-16T11:59:00.000Z' }], pages: 1, truncated: false, responsePayload: [{ messages: [] }] },
      }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'));

    expect(result).toMatchObject({ enabled: true, skipped: false, selected: 1, fetched: 1, inserted: 1, repaired: 0, failed: 0 });
    expect(client.listMessages).toHaveBeenCalledWith('pit-test-token', 'ghl-conversation-1');
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, new Date('2026-10-16T12:00:00.000Z'), true, true);
    expect(persistRunner.commitTransaction).toHaveBeenCalledOnce();
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ghl_guard_logs'), expect.any(Array));
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE ghl_guard_logs'), expect.any(Array));
  });
});
