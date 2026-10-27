import { describe, expect, it, vi } from 'vitest';
import { ConversationDueFunctions } from '../../application/functions/conversations/conversation-due.functions';

describe('ConversationDueFunctions', () => {
  it('limits unattended due selection to conversations with activity in the recent window', async () => {
    const now = new Date('2026-10-26T22:00:00.000Z');
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
    );

    await service.processDueConversations(now, { reconcileActive: false, runGuard: false, recentOnly: true });

    expect(dataSource.query.mock.calls[0][0]).toContain('COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $2::timestamptz');
    expect(dataSource.query.mock.calls[0][1]).toEqual([
      now.toISOString(),
      '2026-10-25T22:00:00.000Z',
    ]);
    expect(dataSource.query.mock.calls[1][0]).toContain('COALESCE(c.last_message_at, c.ready_at, c.waiting_window_started_at, c.created_at) >= $3::timestamptz');
  });

  it('consumes one bounded waiting_window attempt when the due workflow reschedules a recovery cycle', async () => {
    const now = new Date('2026-10-16T22:30:00.000Z');
    const runner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          id: 'conversation-waiting',
          ghl_location_id: 'stafford-location',
          ghl_contact_id: 'contact-waiting',
          ghl_conversation_id: 'ghl-waiting',
          qualification_snapshot: { language: 'en', assigned_dealer_id: 'dealer-stafford' },
          location_snapshot: {},
          ready_at: '2026-10-16T22:00:00.000Z',
          waiting_window_attempts: 0,
          lead_id: 'lead-waiting',
          first_name: 'Test',
          last_name: 'Lead',
        }])
        .mockResolvedValueOnce([]),
    };
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'conversation-waiting' }])
        .mockResolvedValueOnce([{ status: 'waiting_window', next_attempt_at: '2026-10-16T22:35:00.000Z' }]),
      createQueryRunner: vi.fn().mockReturnValue(runner),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      { stafford: { locationId: 'stafford-location' } } as never,
      undefined,
    );

    const result = await service.processDueConversations(now, { reconcileActive: false, runGuard: false });

    expect(result.processed).toBe(0);
    expect(result.advanced).toBe(1);
    expect(result.skipped).toBe(0);
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'waiting_window', next_attempt_at = $2::timestamptz"),
      ['conversation-waiting', '2026-10-16T22:35:00.000Z', '2026-10-16T22:30:00.000Z', 1],
    );
    expect(runner.query.mock.calls[0][0]).toContain("idle_in_transaction_session_timeout = '15s'");
    expect(runner.query.mock.calls[2][0]).toContain('waiting_window_attempts = $4');
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('queues the conversation after the fifth waiting_window cycle even when qualification is still incomplete', async () => {
    const now = new Date('2026-10-16T22:55:00.000Z');
    const runner = {
      connect: vi.fn(),
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(),
      isTransactionActive: true,
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          id: 'conversation-terminal',
          ghl_location_id: 'easterns-location',
          ghl_contact_id: 'contact-terminal',
          ghl_conversation_id: 'ghl-terminal',
          qualification_snapshot: { language: 'en', phone: '+12025550123' },
          location_snapshot: {},
          ready_at: '2026-10-16T22:00:00.000Z',
          waiting_window_attempts: 4,
          lead_id: 'lead-terminal',
          first_name: 'Terminal',
          last_name: 'Lead',
        }])
        .mockResolvedValue([]),
    };
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'conversation-terminal' }]),
      createQueryRunner: vi.fn().mockReturnValue(runner),
    };
    const qualification = {
      findSourceDealer: vi.fn().mockResolvedValue({ id: 'dealer-easterns', name: 'Easterns Rosedale', routing_config: {} }),
      statusForConversation: vi.fn().mockReturnValue({ status: 'partial', nextAttemptAt: null }),
      syncLeadDealer: vi.fn().mockResolvedValue(undefined),
    };
    const queueService = {
      createQueuedPauseEvent: vi.fn().mockResolvedValue(null),
      dispatchQueuedPauseEvent: vi.fn(),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      qualification as never,
      queueService as never,
      {} as never,
      { easterns: { locationId: 'easterns-location' } } as never,
      undefined,
    );

    const result = await service.processDueConversations(now, { reconcileActive: false, runGuard: false });

    expect(result.processed).toBe(1);
    expect(qualification.syncLeadDealer).toHaveBeenCalledOnce();
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE conversations SET status = 'queued'"),
      ['conversation-terminal', 5, '2026-10-16T22:55:00.000Z'],
    );
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });

  it('continues releasing other due contacts when one contact is locked or fails', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'locked-contact' }, { id: 'healthy-contact' }]),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
    );
    const releaseDueConversation = vi
      .spyOn(service as unknown as { releaseDueConversation: (id: string, now: Date) => Promise<boolean> }, 'releaseDueConversation')
      .mockRejectedValueOnce(new Error('lock timeout'))
      .mockRejectedValueOnce(new Error('lock timeout'))
      .mockRejectedValueOnce(new Error('lock timeout'))
      .mockResolvedValueOnce(true);

    const result = await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: false,
    });

    expect(result.processed).toBe(1);
    expect(releaseDueConversation).toHaveBeenCalledTimes(4);
  });

  it('retries a transient release error before leaving a due cycle skipped', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'transient-contact' }]),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
    );
    const releaseDueConversation = vi
      .spyOn(service as unknown as { releaseDueConversation: (id: string, now: Date) => Promise<boolean> }, 'releaseDueConversation')
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValueOnce(true);

    const result = await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: false,
    });

    expect(result).toMatchObject({ accepted: true, processed: 1, advanced: 1, skipped: 0 });
    expect(releaseDueConversation).toHaveBeenCalledTimes(2);
  });

  it('runs the additive GHL guard without the heavy active reconciliation pass', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const reconciliation = {
      reconcileActiveConversations: vi.fn(),
    };
    const guard = {
      run: vi.fn().mockResolvedValue({
        enabled: true,
        skipped: false,
        selected: 1,
        fetched: 2,
        inserted: 1,
        repaired: 0,
        failed: 0,
      }),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      reconciliation as never,
      undefined,
      guard as never,
    );

    const result = await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: true,
      forceGuard: true,
    });

    expect(result.guard).toEqual(expect.objectContaining({ selected: 1, fetched: 2, inserted: 1 }));
    expect(guard.run).toHaveBeenCalledOnce();
    expect(guard.run).toHaveBeenCalledWith(expect.any(Date), { contactIds: undefined, force: true });
    expect(reconciliation.reconcileActiveConversations).not.toHaveBeenCalled();
  });

  it('runs Guard against each due contact before advancing its waiting-window cycle', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'conversation-cycle', ghl_contact_id: 'contact-cycle' }]),
    };
    const guard = {
      run: vi.fn().mockResolvedValue({
        enabled: true,
        skipped: false,
        selected: 1,
        fetched: 1,
        inserted: 1,
        repaired: 1,
        failed: 0,
      }),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      guard as never,
    );
    const release = vi
      .spyOn(service as unknown as { releaseDueConversationWithRetry: (id: string, now: Date) => Promise<{ advanced: boolean; terminal: boolean }> }, 'releaseDueConversationWithRetry')
      .mockResolvedValue({ advanced: true, terminal: false });

    await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: true,
      forceGuard: true,
      recentOnly: true,
    });

    expect(guard.run).toHaveBeenCalledWith(expect.any(Date), {
      contactIds: ['contact-cycle'],
      force: true,
      recentOnly: true,
    });
    expect(release).toHaveBeenCalledWith('conversation-cycle', expect.any(Date));
    expect(guard.run.mock.invocationCallOrder[0]).toBeLessThan(release.mock.invocationCallOrder[0]);
  });

  it('runs one idempotent queued replay immediately after the fifth waiting-window cycle', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'conversation-terminal', ghl_contact_id: 'contact-terminal' }]),
    };
    const guard = {
      run: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          skipped: false,
          selected: 1,
          fetched: 1,
          inserted: 1,
          repaired: 0,
          failed: 0,
        })
        .mockResolvedValueOnce({
          enabled: true,
          skipped: false,
          selected: 1,
          fetched: 1,
          inserted: 0,
          repaired: 1,
          failed: 0,
          queuedReplaySelected: 1,
          queuedReplayCompleted: 1,
          queuedReplayFailed: 0,
          pendingQueuedReplayCount: 0,
        }),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      guard as never,
    );
    const release = vi
      .spyOn(service as unknown as { releaseDueConversationWithRetry: (id: string, now: Date) => Promise<{ advanced: boolean; terminal: boolean }> }, 'releaseDueConversationWithRetry')
      .mockResolvedValue({ advanced: true, terminal: true });

    const result = await service.processDueConversations(new Date('2026-10-16T22:55:00.000Z'), {
      reconcileActive: false,
      runGuard: true,
      forceGuard: true,
      recentOnly: true,
    });

    expect(release).toHaveBeenCalledWith('conversation-terminal', expect.any(Date));
    expect(guard.run).toHaveBeenNthCalledWith(1, expect.any(Date), {
      contactIds: ['contact-terminal'],
      force: true,
      recentOnly: true,
    });
    expect(guard.run).toHaveBeenNthCalledWith(2, expect.any(Date), {
      contactIds: ['contact-terminal'],
      force: true,
      queuedOnly: true,
      recentOnly: true,
    });
    expect(result.guard).toEqual(expect.objectContaining({
      selected: 2,
      fetched: 2,
      inserted: 1,
      repaired: 1,
      queuedReplaySelected: 1,
      queuedReplayCompleted: 1,
    }));
  });

  it('can disable the guard independently from due release processing', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const guard = { run: vi.fn() };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      { reconcileActiveConversations: vi.fn() } as never,
      undefined,
      guard as never,
    );

    const result = await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: false,
    });

    expect(result).toEqual({ accepted: true, processed: 0, advanced: 0, skipped: 0, remainingDue: 0 });
    expect(guard.run).not.toHaveBeenCalled();
  });

  it('keeps the due release successful when the GHL guard is blocked by the global lease', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'conversation-ready' }]),
    };
    const guard = {
      run: vi.fn().mockResolvedValue({
        enabled: true,
        skipped: true,
        skipReason: 'advisory_lock',
        selected: 0,
        fetched: 0,
        inserted: 0,
        repaired: 0,
        failed: 0,
      }),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      guard as never,
    );
    const releaseDueConversation = vi
      .spyOn(service as unknown as { releaseDueConversation: (id: string, now: Date) => Promise<boolean> }, 'releaseDueConversation')
      .mockResolvedValue(true);

    const result = await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: true,
      forceGuard: true,
    });

    expect(result).toMatchObject({ accepted: true, processed: 1, advanced: 1, skipped: 0, guard: { skipped: true, skipReason: 'advisory_lock' } });
    expect(releaseDueConversation).toHaveBeenCalledWith('conversation-ready', expect.any(Date));
  });

  it('retries a due row skipped by SKIP LOCKED until its cycle advances', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'contended-contact' }])
        .mockResolvedValueOnce([{ status: 'waiting_window', next_attempt_at: '2026-10-16T22:30:00.000Z' }])
        .mockResolvedValueOnce([{ status: 'waiting_window', next_attempt_at: '2026-10-16T22:35:00.000Z' }]),
    };
    const service = new ConversationDueFunctions(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
    );
    const releaseDueConversation = vi
      .spyOn(service as unknown as { releaseDueConversation: (id: string, now: Date) => Promise<boolean> }, 'releaseDueConversation')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    const result = await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: false,
    });

    expect(result).toMatchObject({ accepted: true, processed: 0, advanced: 1, skipped: 0 });
    expect(releaseDueConversation).toHaveBeenCalledTimes(2);
  });
});
