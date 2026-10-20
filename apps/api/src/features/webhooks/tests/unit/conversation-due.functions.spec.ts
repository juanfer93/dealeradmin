import { describe, expect, it, vi } from 'vitest';
import { ConversationDueFunctions } from '../../application/functions/conversations/conversation-due.functions';

describe('ConversationDueFunctions', () => {
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
});
