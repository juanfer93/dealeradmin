import { describe, expect, it, vi } from 'vitest';
import { ConversationDueFunctions } from '../../application/functions/conversations/conversation-due.functions';

describe('ConversationDueFunctions', () => {
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
        .mockResolvedValueOnce([{ id: 'conversation-waiting' }]),
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
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'waiting_window', next_attempt_at = $2::timestamptz"),
      ['conversation-waiting', '2026-10-16T22:35:00.000Z', '2026-10-16T22:30:00.000Z'],
    );
    expect(runner.query.mock.calls[0][0]).toContain("idle_in_transaction_session_timeout = '15s'");
    expect(runner.query.mock.calls[2][0]).toContain('waiting_window_attempts = LEAST(waiting_window_attempts + 1, 5)');
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
      .mockResolvedValueOnce(true);

    const result = await service.processDueConversations(new Date('2026-10-16T22:30:00.000Z'), {
      reconcileActive: false,
      runGuard: false,
    });

    expect(result.processed).toBe(1);
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

    expect(result).toEqual({ accepted: true, processed: 0 });
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

    expect(result).toMatchObject({ accepted: true, processed: 1, guard: { skipped: true, skipReason: 'advisory_lock' } });
    expect(releaseDueConversation).toHaveBeenCalledWith('conversation-ready', expect.any(Date));
  });
});
