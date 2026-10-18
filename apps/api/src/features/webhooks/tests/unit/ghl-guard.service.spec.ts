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
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('RETURNING id::text AS id, status'), expect.any(Array));
    const updateLogCall = dataSource.query.mock.calls.find(([sql]) => String(sql).includes('RETURNING id::text AS id, status')) as [string, unknown[]] | undefined;
    expect(updateLogCall?.[0]).toContain('status = $2::varchar');
    expect(updateLogCall?.[0]).toContain('id = $1::uuid');
    expect(updateLogCall?.[0]).toContain("OR status = $2::varchar");
    expect(updateLogCall?.[0]).toContain("CASE WHEN $2::varchar = 'failed'");
    expect(updateLogCall?.[0]).toContain("CASE WHEN $2::varchar IN ('pending', 'running')");
  });

  it('reprocesses only explicitly targeted queued conversations and preserves their queue state', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-targeted',
      ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-targeted',
      ghl_conversation_id: 'ghl-targeted',
      status: 'queued',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ id: row.id, status: row.status }] : sql.includes('INSERT INTO conversation_messages') ? [{ id: 'targeted-message' }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'targeted-log' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'targeted-log', status: 'succeeded' }];
        return [];
      }),
    };
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        ok: true, status: 200, requestPath: '/conversations/ghl-targeted/messages',
        data: { messages: [{ id: 'targeted-message', body: 'Soy Jaime', direction: 'inbound', dateAdded: '2026-10-16T11:59:00.000Z' }], pages: 1, truncated: false, responsePayload: [] },
      }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'), { contactIds: ['contact-targeted'] });

    expect(result).toMatchObject({ skipped: false, selected: 1, fetched: 1, inserted: 1, failed: 0 });
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, expect.any(Date), true, true, true);
    const selectionCall = lockRunner.query.mock.calls.find(([sql]) => String(sql).includes('FROM conversations')) as [string, unknown[]] | undefined;
    expect(selectionCall?.[0]).toContain('ghl_contact_id = ANY($3::text[])');
    expect(selectionCall?.[1]).toEqual([expect.any(Number), expect.arrayContaining([row.ghl_location_id]), ['contact-targeted']]);
    expect(persistRunner.query).toHaveBeenCalledWith(expect.stringContaining("status NOT IN ('sent', 'ignored_channel', 'stale_phone_ignored')"), [row.id]);
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

  it('reuses the conversation that won a synthetic-id identity race', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_INTERVAL_MS = '1';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-synthetic-race', ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-race', ghl_conversation_id: 'contact:contact-race:whatsapp', status: 'waiting_window',
    };
    const winner = { id: 'conversation-real-winner', status: 'partial' };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ id: winner.id, status: winner.status }] : sql.includes('INSERT INTO conversation_messages') ? [{ id: 'message-race' }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'guard-log-race' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'guard-log-race', status: 'succeeded' }];
        if (sql.includes('SET ghl_conversation_id = $2')) {
          throw { code: '23505', constraint: 'conversations_identity_unique', message: 'duplicate key value violates unique constraint "conversations_identity_unique"' };
        }
        if (sql.includes('WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3')) return [winner];
        if (sql.includes('WITH moved AS')) return [{ moved_count: 2, updated_count: 1 }];
        return [];
      }),
    };
    const client = {
      searchConversationByContact: vi.fn().mockResolvedValue({ ok: true, status: 200, requestPath: '/conversations/search', data: { conversation: { id: 'ghl-real-winner' }, total: 1 } }),
      listMessages: vi.fn().mockResolvedValue({ ok: true, status: 200, requestPath: '/conversations/ghl-real-winner/messages', data: { messages: [{ id: 'message-race', body: 'Busco una troca', direction: 'inbound', dateAdded: '2026-10-16T11:59:00.000Z' }], pages: 1, truncated: false, responsePayload: [{ messages: [] }] } }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'), { contactIds: ['contact-race'] });

    expect(result).toMatchObject({ selected: 1, fetched: 1, inserted: 1, failed: 0 });
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(winner.id, expect.any(Date), true, true, true);
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, expect.any(Date), true, true, true);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('WITH moved AS'), [row.id, winner.id]);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3'), [row.ghl_location_id, row.ghl_contact_id, 'ghl-real-winner']);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'duplicate_ignored'"), [row.id]);
  });

  it('surfaces guard-log persistence failures and does not call GHL without an audit row', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_INTERVAL_MS = '1';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-log-failure',
      ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-log-failure',
      ghl_conversation_id: 'ghl-conversation-log-failure',
      status: 'waiting_window',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValue(lockRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) throw new Error('column "lease_expires_at" does not exist');
        return [];
      }),
    };
    const client = { listMessages: vi.fn() };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'));

    expect(result).toMatchObject({ selected: 1, fetched: 0, inserted: 0, repaired: 0, failed: 1 });
    expect(result.errors).toEqual([{
      conversationId: row.id,
      ghlLocationId: row.ghl_location_id,
      ghlContactId: row.ghl_contact_id,
      errorCode: 'GHL_GUARD_LOG_CREATE_FAILED',
      errorMessage: 'column "lease_expires_at" does not exist',
    }]);
    expect(client.listMessages).not.toHaveBeenCalled();
  });

  it('accepts an idempotent audit transition when RETURNING is empty but the row has the target state', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'guard-log-1', status: 'running' }]),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never);

    await (service as unknown as {
      updateLog: (logId: string, status: string, details: Record<string, unknown>) => Promise<void>;
    }).updateLog('guard-log-1', 'running', {});

    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query.mock.calls[1]?.[0]).toContain('SELECT id::text AS id, status');
  });
});
