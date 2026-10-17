import { afterEach, describe, expect, it, vi } from 'vitest';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversation-webhook.config';
import { ghlGuardBatchSize, ghlGuardConcurrency, ghlGuardConversationTimeoutMs, ghlGuardStaleLogMs, ghlGuardTimeoutMs } from '../../application/ghl-guard.config';
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

  it('bounds the guard workload and GHL timeout even when production env values are too high', () => {
    process.env.GHL_GUARD_BATCH_SIZE = '25';
    process.env.GHL_GUARD_CONCURRENCY = '25';
    process.env.GHL_GUARD_TIMEOUT_MS = '60000';

    expect(ghlGuardBatchSize()).toBe(2);
    expect(ghlGuardConcurrency()).toBe(2);
    expect(ghlGuardTimeoutMs()).toBe(15_000);
    expect(ghlGuardConversationTimeoutMs()).toBe(20_000);
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
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'guard-log-1' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'guard-log-1', status: 'succeeded' }];
        return [];
      }),
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
    expect(client.listMessages).toHaveBeenCalledWith('pit-test-token', 'ghl-conversation-1', { deadlineAt: expect.any(Number) });
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, expect.any(Date), true, true);
    expect(persistRunner.commitTransaction).toHaveBeenCalledOnce();
    const selectionCall = lockRunner.query.mock.calls.find(([sql]) => String(sql).includes('FROM conversations')) as [string, unknown[]] | undefined;
    expect(selectionCall?.[0]).toContain('LEFT JOIN LATERAL');
    expect(selectionCall?.[0]).toContain('ORDER BY last_guard.created_at NULLS FIRST');
    const insertLogCall = dataSource.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO ghl_guard_logs')) as [string, unknown[]] | undefined;
    expect(insertLogCall?.[0]).toContain("CURRENT_TIMESTAMP + ($8::integer * INTERVAL '1 millisecond')");
    expect(insertLogCall?.[1]?.[7]).toBe(ghlGuardStaleLogMs());
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE ghl_guard_logs'), expect.any(Array));
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE ghl_guard_logs'), expect.arrayContaining([expect.any(Number)]));
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('RETURNING id, status'), expect.any(Array));
    const updateLogCall = dataSource.query.mock.calls.find(([sql]) => String(sql).includes('RETURNING id, status')) as [string, unknown[]] | undefined;
    expect(updateLogCall?.[0]).toContain('status = $2::varchar');
    expect(updateLogCall?.[0]).toContain("CASE WHEN $2::varchar = 'failed'");
    expect(updateLogCall?.[0]).toContain("CASE WHEN $2::varchar IN ('pending', 'running')");
  });

  it('resolves a synthetic conversation id by contact and persists the real GHL id', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_INTERVAL_MS = '1';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-synthetic', ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-1', ghl_conversation_id: 'contact:contact-1:whatsapp', status: 'waiting_window',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ id: row.id, status: row.status }] : sql.includes('INSERT INTO conversation_messages') ? [{ id: 'message-1' }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'guard-log-1' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'guard-log-1', status: 'succeeded' }];
        return [];
      }),
    };
    const client = {
      searchConversationByContact: vi.fn().mockResolvedValue({ ok: true, status: 200, requestPath: '/conversations/search', data: { conversation: { id: 'ghl-real-conversation' }, total: 1 } }),
      listMessages: vi.fn().mockResolvedValue({ ok: true, status: 200, requestPath: '/conversations/ghl-real-conversation/messages', data: { messages: [{ id: 'message-1', body: 'Busco una troca', direction: 'inbound', dateAdded: '2026-10-16T11:59:00.000Z' }], pages: 1, truncated: false, responsePayload: [{ messages: [] }] } }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'));

    expect(result).toMatchObject({ selected: 1, fetched: 1, inserted: 1, failed: 0 });
    expect(client.searchConversationByContact).toHaveBeenCalledWith('pit-test-token', row.ghl_location_id, row.ghl_contact_id, { deadlineAt: expect.any(Number) });
    expect(client.listMessages).toHaveBeenCalledWith('pit-test-token', 'ghl-real-conversation', { deadlineAt: expect.any(Number) });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining("SET ghl_conversation_id = $2"), [row.id, 'ghl-real-conversation']);
  });
});
