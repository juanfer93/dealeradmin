import { afterEach, describe, expect, it, vi } from 'vitest';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversations/conversation-webhook.config';
import { ghlGuardBatchSize, ghlGuardConcurrency, ghlGuardConversationTimeoutMs, ghlGuardLeaseMs, ghlGuardStaleLogMs, ghlGuardTimeoutMs } from '../../application/ghl-guard.config';
import { GhlGuardService } from '../../application/ghl-guard.service';
import { GhlGuardPersistenceFunctions } from '../../application/functions/ghl-guard/ghl-guard-persistence.functions';

describe('GhlGuardService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  it('does not call GHL or the database when disabled', async () => {
    process.env.NODE_ENV = 'test';
    process.env.GHL_GUARD_ENABLED = 'false';
    const dataSource = { createQueryRunner: vi.fn(), query: vi.fn() } as never;
    const service = new GhlGuardService(dataSource, { reconcileConversation: vi.fn() } as never);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'));

    expect(result).toEqual({ enabled: false, skipped: true, skipReason: 'disabled', selected: 0, fetched: 0, inserted: 0, repaired: 0, failed: 0 });
    expect((dataSource as { createQueryRunner: ReturnType<typeof vi.fn> }).createQueryRunner).not.toHaveBeenCalled();
  });

  it('bounds the guard workload and GHL timeout even when production env values are too high', () => {
    process.env.GHL_GUARD_BATCH_SIZE = '25';
    process.env.GHL_GUARD_CONCURRENCY = '25';
    process.env.GHL_GUARD_TIMEOUT_MS = '60000';
    process.env.GHL_GUARD_CONVERSATION_TIMEOUT_MS = '60000';
    process.env.GHL_GUARD_LEASE_MS = '999999';

    expect(ghlGuardBatchSize()).toBe(2);
    expect(ghlGuardConcurrency()).toBe(2);
    expect(ghlGuardTimeoutMs()).toBe(30_000);
    expect(ghlGuardConversationTimeoutMs()).toBe(60_000);
    expect(ghlGuardLeaseMs()).toBe(600_000);
  });

  it('allows the scheduled run to bypass the in-memory interval gate', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_INTERVAL_MS = '300000';

    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : []),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValue(lockRunner),
      query: vi.fn().mockResolvedValue([]),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never);
    const firstRun = new Date('2026-10-16T12:00:00.000Z');

    await service.run(firstRun);
    const skipped = await service.run(new Date(firstRun.getTime() + 1000));
    const result = await service.run(new Date(firstRun.getTime() + 1000), { force: true });

    expect(skipped).toMatchObject({ enabled: true, skipped: true, skipReason: 'in_memory_interval' });
    expect(result).toMatchObject({ enabled: true, skipped: false, selected: 0, fetched: 0, inserted: 0, repaired: 0, failed: 0 });
    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(2);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('skip_reason'), expect.arrayContaining(['in_memory_interval']));
  });

  it('prioritizes durable guard retries that are already due', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';

    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : []),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValue(lockRunner),
      query: vi.fn().mockResolvedValue([]),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never);

    await service.run(new Date('2026-10-22T12:00:00.000Z'), { force: true, queuedOnly: true });

    const selection = lockRunner.query.mock.calls.find(([sql]) => String(sql).includes('FROM conversations'))?.[0] as string;
    expect(selection).toContain('due_retry.next_retry_at IS NOT NULL');
    expect(selection).toContain('CASE WHEN due_retry.next_retry_at IS NOT NULL THEN 0 ELSE 1 END');
    expect(selection).toContain('due_retry.next_retry_at ASC NULLS LAST');
    expect(selection).toContain("retry_guard.error_code IS DISTINCT FROM 'GHL_GUARD_STALE_RUN'");
    expect(selection).toContain("retry_guard.metadata->>'recoveryReason'");
    expect(selection).toContain("queued_sibling.status = 'queued'");
    expect(selection).toContain('queued_sibling.ghl_contact_id = c.ghl_contact_id');
    expect(selection).toContain('queued_sibling.id <> c.id');
    expect(selection).toContain('queued_lead.canonical_phone');
  });

  it('reports when the advisory lock prevents a guard cycle', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';

    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [] : []),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValue(lockRunner),
      query: vi.fn().mockResolvedValue([]),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'), { force: true });

    expect(result).toMatchObject({ enabled: true, skipped: true, skipReason: 'advisory_lock', selected: 0, fetched: 0, inserted: 0, repaired: 0, failed: 0 });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE ghl_guard_logs'), expect.any(Array));
    expect(lockRunner.release).toHaveBeenCalledOnce();
  });

  it('does not let an advisory-lock skip suppress the next scheduler attempt', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_INTERVAL_MS = '300000';

    const firstLockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [] : []),
      release: vi.fn(),
    };
    const secondLockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : []),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(firstLockRunner)
        .mockReturnValueOnce(secondLockRunner),
      query: vi.fn().mockResolvedValue([]),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never);
    const firstRun = new Date('2026-10-24T12:00:00.000Z');

    const skipped = await service.run(firstRun, { force: true });
    const retried = await service.run(new Date(firstRun.getTime() + 1000));

    expect(skipped).toMatchObject({ skipped: true, skipReason: 'advisory_lock' });
    expect(retried).toMatchObject({ skipped: false, selected: 0, failed: 0 });
    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(2);
  });

  it('retries targeted contacts after an advisory-lock skip instead of dropping them', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_RETRY_DELAY_MS = '1';
    vi.useFakeTimers();

    const firstLockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [] : []),
      release: vi.fn(),
    };
    const secondLockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_leases')) return [{ owner_id: 'lease-owner' }];
        if (sql.includes('FROM conversations')) return [];
        return [];
      }),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(firstLockRunner)
        .mockReturnValueOnce(secondLockRunner),
      query: vi.fn().mockResolvedValue([]),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never);

    const result = await service.run(new Date('2026-10-19T12:00:00.000Z'), { contactIds: ['adrian-contact'], force: true });
    expect(result).toMatchObject({ skipped: true, skipReason: 'advisory_lock' });

    await vi.advanceTimersByTimeAsync(1);

    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(2);
    expect(secondLockRunner.release).toHaveBeenCalledOnce();
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('skip_reason'), expect.arrayContaining(['advisory_lock']));
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
        if (sql.includes('INSERT INTO ghl_guard_leases')) return [{ owner_id: 'lease-owner' }];
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
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, expect.any(Date), true, true, false, false);
    expect(persistRunner.commitTransaction).toHaveBeenCalledOnce();
    const selectionCall = lockRunner.query.mock.calls.find(([sql]) => String(sql).includes('FROM conversations')) as [string, unknown[]] | undefined;
    expect(selectionCall?.[0]).toContain('LEFT JOIN LATERAL');
    expect(selectionCall?.[0]).toContain('ORDER BY CASE WHEN due_retry.next_retry_at IS NOT NULL THEN 0 ELSE 1 END');
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
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ id: row.id, status: row.status }] : sql.includes('INSERT INTO conversation_messages') ? [{ id: 'targeted-message' }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const replayClaimRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ status: row.status, queued_guard_replay_count: 0, queued_guard_replay_claimed_at: null }] : sql.includes('queued_guard_replay_claimed_at = CURRENT_TIMESTAMP') ? [{ id: row.id }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(replayClaimRunner).mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'targeted-log' }];
        if (sql.includes('UPDATE conversations') && sql.includes('queued_guard_replay_count')) return [{ id: row.id }];
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
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, expect.any(Date), true, true, true, false);
    const selectionCall = lockRunner.query.mock.calls.find(([sql]) => String(sql).includes('FROM conversations')) as [string, unknown[]] | undefined;
    expect(selectionCall?.[0]).toContain('ghl_contact_id = ANY($3::text[])');
    expect(selectionCall?.[1]).toEqual([expect.any(Number), expect.arrayContaining([row.ghl_location_id]), ['contact-targeted']]);
    expect(persistRunner.query).toHaveBeenCalledWith(expect.stringContaining("status NOT IN ('sent', 'ignored_channel', 'stale_phone_ignored')"), [row.id]);
  });

  it('gives an automatically selected queued conversation one durable replay', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-queued-replay',
      ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-queued-replay',
      ghl_conversation_id: 'ghl-queued-replay',
      status: 'queued',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const replayClaimRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ status: row.status, queued_guard_replay_count: 0, queued_guard_replay_claimed_at: null }] : sql.includes('queued_guard_replay_claimed_at = CURRENT_TIMESTAMP') ? [{ id: row.id }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ id: row.id, status: row.status }] : sql.includes('INSERT INTO conversation_messages') ? [{ id: 'queued-replay-message' }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(replayClaimRunner).mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'queued-replay-log' }];
        if (sql.includes('UPDATE conversations') && sql.includes('queued_guard_replay_count')) return [{ id: row.id }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'queued-replay-log', status: 'succeeded' }];
        return [];
      }),
    };
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        ok: true, status: 200, requestPath: '/conversations/ghl-queued-replay/messages',
        data: { messages: [{ id: 'queued-replay-message', body: 'Busco una troca', direction: 'inbound', dateAdded: '2026-10-16T11:59:00.000Z' }], pages: 1, truncated: false, responsePayload: [] },
      }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'), { queuedOnly: true, force: true });

    expect(result).toMatchObject({ skipped: false, selected: 1, fetched: 1, inserted: 1, failed: 0 });
    expect(replayClaimRunner.commitTransaction).toHaveBeenCalledOnce();
    const selectionCall = lockRunner.query.mock.calls.find(([sql]) => String(sql).includes('FROM conversations')) as [string, unknown[]] | undefined;
    expect(selectionCall?.[0]).toContain("status = 'queued' AND queued_guard_replay_count = 0");
    expect(selectionCall?.[0]).toContain("retry_guard.next_retry_at > CURRENT_TIMESTAMP");
    expect(selectionCall?.[0]).toContain('updated_at DESC NULLS LAST');
    expect(replayClaimRunner.query).toHaveBeenCalledWith(expect.stringContaining('queued_guard_replay_claimed_at = CURRENT_TIMESTAMP'), [row.id, expect.any(Number)]);
  });

  it('releases a queued replay claim when GHL times out so the next cycle can retry', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_RETRY_DELAY_MS = '600000';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-queued-timeout',
      ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-queued-timeout',
      ghl_conversation_id: 'ghl-queued-timeout',
      status: 'queued',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const replayClaimRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE')
        ? [{ status: row.status, queued_guard_replay_count: 0, queued_guard_replay_claimed_at: null }]
        : sql.includes('queued_guard_replay_claimed_at = CURRENT_TIMESTAMP') ? [{ id: row.id }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(replayClaimRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'queued-timeout-log' }];
        if (sql.includes('UPDATE conversations') && sql.includes('queued_guard_replay_claimed_at = NULL')) return [{ id: row.id }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'queued-timeout-log', status: 'failed' }];
        return [];
      }),
    };
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: '/conversations/ghl-queued-timeout/messages',
      }),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-22T12:00:00.000Z'));

    expect(result).toMatchObject({ skipped: false, selected: 1, failed: 1 });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('queued_guard_replay_claimed_at = NULL'), [row.id]);
    expect(dataSource.query).not.toHaveBeenCalledWith(expect.stringContaining('queued_guard_replay_count = queued_guard_replay_count + 1'), [row.id]);
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
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
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

  it('uses a local canonical sibling before calling the slow GHL conversation search', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-synthetic-local', ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-local', ghl_conversation_id: 'contact:contact-local:messenger', status: 'partial',
    };
    const canonical = {
      id: 'conversation-canonical-local', ghl_conversation_id: 'ghl-local-conversation', status: 'partial',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ id: canonical.id, status: canonical.status }] : sql.includes('INSERT INTO conversation_messages') ? [{ id: 'message-local' }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT canonical.id')) return [canonical];
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'guard-log-local' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'guard-log-local', status: 'succeeded' }];
        return [];
      }),
    };
    const client = {
      searchConversationByContact: vi.fn(),
      listMessages: vi.fn().mockResolvedValue({
        ok: true, status: 200, requestPath: '/conversations/ghl-local-conversation/messages',
        data: { messages: [{ id: 'message-local', body: 'Busco una troca', direction: 'inbound', dateAdded: '2026-10-22T12:00:00.000Z' }], pages: 1, truncated: false, responsePayload: [] },
      }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-22T12:00:00.000Z'), { contactIds: [row.ghl_contact_id], force: true });

    expect(result).toMatchObject({ selected: 1, fetched: 1, inserted: 1, failed: 0 });
    expect(client.searchConversationByContact).not.toHaveBeenCalled();
    expect(client.listMessages).toHaveBeenCalledWith('pit-test-token', canonical.ghl_conversation_id, { deadlineAt: expect.any(Number) });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('WITH moved AS'), [row.id, canonical.id]);
  });

  it('consumes queued replay on both synthetic and canonical sibling rows', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-synthetic-queued', ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-queued-local', ghl_conversation_id: 'contact:contact-queued-local:messenger', status: 'queued',
    };
    const canonical = {
      id: 'conversation-canonical-queued', ghl_conversation_id: 'ghl-queued-conversation', status: 'queued',
    };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValue(lockRunner),
      query: vi.fn(async (sql: string) => sql.includes('SELECT canonical.id') ? [canonical] : []),
    };
    const completedReplayIds: string[] = [];
    const persistence = {
      recoverStaleLogs: vi.fn().mockResolvedValue(undefined),
      recoverStaleQueuedReplayClaims: vi.fn().mockResolvedValue(undefined),
      createLog: vi.fn().mockResolvedValue('guard-log-queued-local'),
      updateLog: vi.fn().mockResolvedValue(undefined),
      claimQueuedReplay: vi.fn().mockResolvedValue({ allowed: true, claimed: true }),
      persistMessages: vi.fn().mockResolvedValue({ skipped: false, inserted: 1, repaired: 0 }),
      mergeSyntheticConversationMessages: vi.fn().mockResolvedValue(0),
      readLeadMetadata: vi.fn().mockResolvedValue({}),
      completeQueuedReplay: vi.fn(async (conversationId: string) => {
        completedReplayIds.push(conversationId);
        return true;
      }),
      releaseQueuedReplay: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      listMessages: vi.fn().mockResolvedValue({
        ok: true, status: 200, requestPath: '/conversations/ghl-queued-conversation/messages',
        data: { messages: [{ id: 'message-queued', body: 'Busco una troca', direction: 'inbound', dateAdded: '2026-10-22T12:00:00.000Z' }], pages: 1, truncated: false, responsePayload: [] },
      }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);
    (service as any).persistence = persistence;

    const result = await service.run(new Date('2026-10-22T12:00:00.000Z'), { contactIds: [row.ghl_contact_id], force: true, queuedOnly: true });

    expect(result).toMatchObject({ selected: 1, fetched: 1, inserted: 1, failed: 0, queuedReplaySelected: 1, queuedReplayCompleted: 1 });
    expect(persistence.claimQueuedReplay).toHaveBeenCalledWith(row.id, true);
    expect(persistence.claimQueuedReplay).toHaveBeenCalledWith(canonical.id, true);
    expect(completedReplayIds).toEqual(expect.arrayContaining([row.id, canonical.id]));
    expect(persistence.releaseQueuedReplay).not.toHaveBeenCalled();
  });

  it('retries a transient synthetic-conversation lookup failure by contact', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_RETRY_DELAY_MS = '1';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';
    vi.useFakeTimers();

    const row = {
      id: 'conversation-timeout', ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-timeout', ghl_conversation_id: 'contact:contact-timeout:messenger', status: 'partial',
    };
    const firstLockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const secondLockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : []),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(firstLockRunner).mockReturnValueOnce(secondLockRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'timeout-log' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'timeout-log', status: 'failed' }];
        return [];
      }),
    };
    const client = {
      searchConversationByContact: vi.fn().mockResolvedValue({
        ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: '/conversations/search',
      }),
      listMessages: vi.fn(),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'), { contactIds: [row.ghl_contact_id], force: true });

    expect(result).toMatchObject({ selected: 1, failed: 1 });
    expect(client.searchConversationByContact).toHaveBeenCalledOnce();
    expect(client.listMessages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(2);
    expect(secondLockRunner.release).toHaveBeenCalledOnce();
  });

  it('retries durable Guard failure close-out after a transient Neon read timeout', async () => {
    const timeoutError = new Error('Query read timeout');
    timeoutError.name = 'QueryFailedError';
    const dataSource = {
      query: vi.fn()
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce([{ id: 'guard-log-recovered', status: 'failed' }]),
    };
    const persistence = new GhlGuardPersistenceFunctions(dataSource as never);

    await persistence.safeUpdateLog('guard-log-recovered', 'failed', { errorCode: 'QueryFailedError' });

    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });

  it('opens a source circuit after repeated transient failures without calling GHL again', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_RETRY_DELAY_MS = '1';
    process.env.GHL_GUARD_CIRCUIT_FAILURE_THRESHOLD = '1';
    process.env.GHL_GUARD_CIRCUIT_COOLDOWN_MS = '1000';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';
    vi.useFakeTimers();

    const row = {
      id: 'conversation-circuit', ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-circuit', ghl_conversation_id: 'contact:contact-circuit:messenger', status: 'partial',
    };
    const makeLockRunner = () => ({
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    });
    const firstLockRunner = makeLockRunner();
    const secondLockRunner = makeLockRunner();
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(firstLockRunner).mockReturnValueOnce(secondLockRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'circuit-log' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'circuit-log', status: 'skipped' }];
        return [];
      }),
    };
    const client = {
      searchConversationByContact: vi.fn().mockResolvedValue({
        ok: false, status: 0, errorCode: 'GHL_TIMEOUT', requestPath: '/conversations/search',
      }),
      listMessages: vi.fn(),
    };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never, GHL_SOURCE_CONFIG, client);
    const runSpy = vi.spyOn(service, 'run');

    await service.run(new Date('2026-10-16T12:00:00.000Z'), { contactIds: [row.ghl_contact_id], force: true });
    await vi.advanceTimersByTimeAsync(1);

    expect(client.searchConversationByContact).toHaveBeenCalledOnce();
    const deferredResult = await (runSpy.mock.results[1]?.value as Promise<unknown>);
    expect(deferredResult).toMatchObject({ selected: 1, failed: 1 });
    expect(dataSource.query.mock.calls.some((call) => JSON.stringify(call).includes('GHL_CIRCUIT_OPEN'))).toBe(true);
    vi.clearAllTimers();
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
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
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
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(winner.id, expect.any(Date), true, true, true, false);
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, expect.any(Date), true, true, true, false);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SET qualification_snapshot = canonical.qualification_snapshot'), [row.id, winner.id]);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('WITH moved AS'), [row.id, winner.id]);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3'), [row.ghl_location_id, row.ghl_contact_id, 'ghl-real-winner']);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'duplicate_ignored'"), [row.id]);
  });

  it('synchronizes the synthetic snapshot after a scheduled split reconciliation', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_GUARD_INTERVAL_MS = '1';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const row = {
      id: 'conversation-scheduled-synthetic', ghl_location_id: GHL_SOURCE_CONFIG.stafford.locationId,
      ghl_contact_id: 'contact-scheduled-split', ghl_conversation_id: 'contact:contact-scheduled-split:messenger', status: 'partial',
    };
    const winner = { id: 'conversation-scheduled-real', status: 'partial' };
    const lockRunner = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
      release: vi.fn(),
    };
    const persistRunner = {
      connect: vi.fn(), startTransaction: vi.fn(), isTransactionActive: true,
      query: vi.fn(async (sql: string) => sql.includes('FOR UPDATE') ? [{ id: winner.id, status: winner.status }] : sql.includes('INSERT INTO conversation_messages') ? [{ id: 'scheduled-split-message' }] : []),
      commitTransaction: vi.fn(), rollbackTransaction: vi.fn(), release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(lockRunner).mockReturnValueOnce(persistRunner),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO ghl_guard_logs')) return [{ id: 'scheduled-split-log' }];
        if (sql.includes('UPDATE ghl_guard_logs')) return [{ id: 'scheduled-split-log', status: 'succeeded' }];
        if (sql.includes('SET ghl_conversation_id = $2')) throw { code: '23505', constraint: 'conversations_identity_unique', message: 'duplicate key value violates unique constraint' };
        if (sql.includes('WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3')) return [winner];
        if (sql.includes('WITH moved AS')) return [{ moved_count: 1, updated_count: 1 }];
        return [];
      }),
    };
    const client = {
      searchConversationByContact: vi.fn().mockResolvedValue({ ok: true, status: 200, requestPath: '/conversations/search', data: { conversation: { id: 'ghl-scheduled-real' }, total: 1 } }),
      listMessages: vi.fn().mockResolvedValue({ ok: true, status: 200, requestPath: '/conversations/ghl-scheduled-real/messages', data: { messages: [{ id: 'scheduled-split-message', body: 'Busco una troca', direction: 'inbound', dateAdded: '2026-10-16T11:59:00.000Z' }], pages: 1, truncated: false, responsePayload: [] } }),
    };
    const reconciliation = { reconcileConversation: vi.fn().mockResolvedValue(undefined) };
    const service = new GhlGuardService(dataSource as never, reconciliation as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'));

    expect(result).toMatchObject({ selected: 1, fetched: 1, inserted: 1, failed: 0 });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SET qualification_snapshot = canonical.qualification_snapshot'), [row.id, winner.id]);
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(winner.id, expect.any(Date), true, true, false, false);
    expect(reconciliation.reconcileConversation).toHaveBeenCalledWith(row.id, expect.any(Date), true, true, true, false);
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
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO ghl_guard_leases') ? [{ owner_id: 'lease-owner' }] : sql.includes('FROM conversations') ? [row] : []),
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

  it('persists a run-level audit row when the database runner cannot connect', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_GUARD_ENABLED = 'true';
    process.env.GHL_PRIVATE_TOKEN_STAFFORD = 'pit-test-token';

    const lockRunner = {
      connect: vi.fn().mockRejectedValue(new Error('server conn crashed?')),
      query: vi.fn(),
      release: vi.fn(),
    };
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValue(lockRunner),
      query: vi.fn().mockResolvedValue([]),
    };
    const client = { listMessages: vi.fn() };
    const service = new GhlGuardService(dataSource as never, { reconcileConversation: vi.fn() } as never, GHL_SOURCE_CONFIG, client);

    const result = await service.run(new Date('2026-10-16T12:00:00.000Z'), {
      contactIds: ['contact-run-connect-failure'],
      force: true,
    });

    expect(result).toMatchObject({ selected: 0, failed: 1 });
    expect(result.errors).toEqual([{
      conversationId: null,
      ghlLocationId: null,
      ghlContactId: null,
      errorCode: 'Error',
      errorMessage: 'server conn crashed?',
    }]);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ghl_guard_logs'),
      expect.arrayContaining([expect.any(String), null, null, null, null, 'failed']),
    );
    const auditInsert = dataSource.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO ghl_guard_logs'));
    expect(JSON.parse(String(auditInsert?.[1]?.[12]))).toEqual(expect.objectContaining({
      errorCode: 'Error',
      errorMessage: 'server conn crashed?',
      targetContactIds: ['contact-run-connect-failure'],
    }));
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
