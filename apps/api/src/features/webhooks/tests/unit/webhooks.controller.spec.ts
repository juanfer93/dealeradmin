import { describe, expect, it, vi } from 'vitest';
import { WebhooksController } from '../../presentation/webhooks.controller';

describe('WebhooksController queued Guard backup', () => {
  it('delegates failed webhook replay to the protected service flow', async () => {
    const replayFailedIngress = vi.fn().mockResolvedValue({ accepted: true, selected: 1, processed: 1, failed: 0 });
    const controller = new WebhooksController(
      {} as never,
      { replayFailedIngress } as never,
      {} as never,
      {} as never,
    );

    await controller.replayFailedWebhooks({ query: { since: '2026-10-27T18:00:00.000Z', limit: '250' } } as never);

    expect(replayFailedIngress).toHaveBeenCalledWith({ since: new Date('2026-10-27T18:00:00.000Z'), limit: 250 });
  });

  it('releases due contacts without waiting for Guard', async () => {
    const processDueConversations = vi.fn().mockResolvedValue({
      accepted: true,
      processed: 1,
      advanced: 1,
      skipped: 0,
      remainingDue: 0,
    });
    const controller = new WebhooksController(
      {} as never,
      { processDueConversations } as never,
      {} as never,
      {} as never,
    );

    await controller.processDueConversationsOnlyCron({ query: { contact_ids: 'contact-cycle-a,contact-cycle-b' } } as never);

    expect(processDueConversations).toHaveBeenCalledWith(undefined, {
      reconcileActive: false,
      runGuard: false,
      dueContactIds: ['contact-cycle-a', 'contact-cycle-b'],
      recentOnly: true,
    });
  });

  it('uses database due health and clears overdue rows through the watchdog', async () => {
    const getDueConversationHealth = vi.fn()
      .mockResolvedValueOnce({
        accepted: true,
        checkedAt: '2026-10-26T14:41:43.000Z',
        waitingWindowCount: 1,
        overdueCount: 1,
        missingNextAttemptCount: 0,
        oldestDueAt: '2026-10-26T14:41:30.000Z',
        overdueConversations: [{ id: 'conversation-rodney', ghlContactId: 'rodney', nextAttemptAt: '2026-10-26T14:41:30.000Z', waitingWindowAttempts: 4 }],
      })
      .mockResolvedValueOnce({
        accepted: true,
        checkedAt: '2026-10-26T14:42:24.000Z',
        waitingWindowCount: 0,
        overdueCount: 0,
        missingNextAttemptCount: 0,
        oldestDueAt: null,
        overdueConversations: [],
      });
    const processDueConversations = vi.fn().mockResolvedValue({
      accepted: true,
      processed: 1,
      advanced: 1,
      skipped: 0,
      remainingDue: 0,
    });
    const controller = new WebhooksController(
      {} as never,
      { getDueConversationHealth, processDueConversations } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.dueConversationWatchdog();

    expect(result.accepted).toBe(true);
    expect(result.triggered).toBe(true);
    expect(processDueConversations).toHaveBeenCalledWith(undefined, { reconcileActive: false, runGuard: false, recentOnly: true });
    expect(getDueConversationHealth).toHaveBeenCalledTimes(2);
  });

  it('does not release a cycle when database health is clear', async () => {
    const getDueConversationHealth = vi.fn().mockResolvedValue({
      accepted: true,
      checkedAt: '2026-10-26T14:45:00.000Z',
      waitingWindowCount: 1,
      overdueCount: 0,
      missingNextAttemptCount: 0,
      oldestDueAt: null,
      overdueConversations: [],
    });
    const processDueConversations = vi.fn();
    const controller = new WebhooksController(
      {} as never,
      { getDueConversationHealth, processDueConversations } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.dueConversationWatchdog();

    expect(result).toMatchObject({ accepted: true, triggered: false, remainingDue: 0 });
    expect(processDueConversations).not.toHaveBeenCalled();
  });

  it('wakes Guard for due partial recovery without releasing a waiting-window cycle', async () => {
    const getDueConversationHealth = vi.fn().mockResolvedValue({
      accepted: true,
      checkedAt: '2026-10-30T14:00:00.000Z',
      waitingWindowCount: 1,
      overdueCount: 0,
      missingNextAttemptCount: 0,
      oldestDueAt: null,
      partialRecoveryDueCount: 1,
      partialGuardContactIds: ['partial-contact'],
      guardRetryContactIds: [],
      overdueConversations: [],
    });
    const processDueConversations = vi.fn();
    const controller = new WebhooksController(
      {} as never,
      { getDueConversationHealth, processDueConversations } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.dueConversationWatchdog();

    expect(result).toMatchObject({
      accepted: true,
      triggered: true,
      partialRecoveryTriggered: true,
      guardContactIds: ['partial-contact'],
    });
    expect(processDueConversations).not.toHaveBeenCalled();
  });

  it('runs the independent automatic cycle with Guard and queued replay when due work exists', async () => {
    const getDueConversationHealth = vi.fn()
      .mockResolvedValueOnce({
        accepted: true,
        checkedAt: '2026-10-28T03:45:00.000Z',
        waitingWindowCount: 1,
        overdueCount: 1,
        missingNextAttemptCount: 0,
        oldestDueAt: '2026-10-28T03:44:00.000Z',
        overdueConversations: [],
      })
      .mockResolvedValueOnce({
        accepted: true,
        checkedAt: '2026-10-28T03:46:00.000Z',
        waitingWindowCount: 1,
        overdueCount: 0,
        missingNextAttemptCount: 0,
        oldestDueAt: null,
        overdueConversations: [],
      });
    const processDueConversations = vi.fn().mockResolvedValue({
      accepted: true,
      processed: 1,
      advanced: 1,
      skipped: 0,
      remainingDue: 0,
      guardContactIds: ['contact-cycle-a'],
      guard: { failed: 0 },
    });
    const runGhlGuard = vi.fn().mockResolvedValue({ failed: 0, queuedReplaySelected: 0, queuedReplayCompleted: 0 });
    const controller = new WebhooksController(
      {} as never,
      { getDueConversationHealth, processDueConversations, runGhlGuard } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.automaticCycle();

    expect(result.accepted).toBe(true);
    expect(processDueConversations).toHaveBeenCalledWith(undefined, {
      reconcileActive: false,
      runGuard: true,
      forceGuard: true,
      recentOnly: true,
    });
    expect(runGhlGuard).toHaveBeenCalledWith(undefined, {
      contactIds: [],
      queuedOnly: true,
      force: true,
      recentOnly: true,
    });
    expect(getDueConversationHealth).toHaveBeenCalledTimes(2);
  });

  it('wakes the Guard when only a durable GHL retry is due', async () => {
    const getDueConversationHealth = vi.fn()
      .mockResolvedValueOnce({
        accepted: true,
        checkedAt: '2026-10-29T17:10:00.000Z',
        waitingWindowCount: 0,
        overdueCount: 0,
        missingNextAttemptCount: 0,
        oldestDueAt: null,
        guardRetryContactIds: ['ghl-contact-timeout'],
        overdueConversations: [],
      })
      .mockResolvedValueOnce({
        accepted: true,
        checkedAt: '2026-10-29T17:10:05.000Z',
        waitingWindowCount: 0,
        overdueCount: 0,
        missingNextAttemptCount: 0,
        oldestDueAt: null,
        guardRetryContactIds: [],
        overdueConversations: [],
      });
    const processDueConversations = vi.fn().mockResolvedValue({
      accepted: true,
      processed: 0,
      advanced: 0,
      skipped: 0,
      remainingDue: 0,
      guardContactIds: ['ghl-contact-timeout'],
      guard: { failed: 0 },
    });
    const runGhlGuard = vi.fn().mockResolvedValue({ failed: 0, queuedReplaySelected: 0, queuedReplayCompleted: 0 });
    const controller = new WebhooksController(
      {} as never,
      { getDueConversationHealth, processDueConversations, runGhlGuard } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.automaticCycle();

    expect(result.triggered).toBe(true);
    expect(processDueConversations).toHaveBeenCalledWith(undefined, {
      reconcileActive: false,
      runGuard: true,
      forceGuard: true,
      guardContactIds: ['ghl-contact-timeout'],
      recentOnly: true,
    });
  });

  it('does not acknowledge the backup while queued replays remain pending', async () => {
    const runGhlGuard = vi.fn().mockResolvedValue({
      enabled: true,
      skipped: false,
      selected: 0,
      fetched: 0,
      inserted: 0,
      repaired: 0,
      failed: 0,
      queuedReplaySelected: 0,
      queuedReplayCompleted: 0,
      pendingQueuedReplayCount: 1,
    });
    const controller = new WebhooksController(
      {} as never,
      { runGhlGuard } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.runGuardCron({ query: { queued_backup: 'true' } } as never);

    expect(result.accepted).toBe(false);
    expect(runGhlGuard).toHaveBeenCalledWith(undefined, {
      contactIds: [],
      queuedOnly: true,
      force: true,
      recentOnly: true,
    });
  });

  it('reconciles a targeted partial contact before the slow Guard retry', async () => {
    const reconcileContactIds = vi.fn().mockResolvedValue(1);
    const runGhlGuard = vi.fn().mockResolvedValue({
      enabled: true,
      skipped: false,
      selected: 1,
      fetched: 0,
      inserted: 0,
      repaired: 0,
      failed: 1,
    });
    const controller = new WebhooksController(
      {} as never,
      { reconcileContactIds, runGhlGuard } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.runGuardCron({
      query: { contact_ids: 'ghl-contact-timeout', reconcile: 'true' },
    } as never);

    expect(result.reconciledContactCount).toBe(1);
    expect(reconcileContactIds).toHaveBeenCalledWith(['ghl-contact-timeout']);
    expect(runGhlGuard).toHaveBeenCalledWith(undefined, {
      contactIds: ['ghl-contact-timeout'],
      queuedOnly: false,
      force: true,
      recentOnly: false,
    });
    expect(reconcileContactIds.mock.invocationCallOrder[0]).toBeLessThan(runGhlGuard.mock.invocationCallOrder[0]);
  });

  it('acknowledges a completed bounded batch even when older queued rows remain', async () => {
    const controller = new WebhooksController(
      {} as never,
      {
        runGhlGuard: vi.fn().mockResolvedValue({
          enabled: true,
          skipped: false,
          selected: 1,
          fetched: 1,
          inserted: 1,
          repaired: 0,
          failed: 0,
          queuedReplaySelected: 1,
          queuedReplayCompleted: 1,
          pendingQueuedReplayCount: 456,
        }),
      } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.runGuardCron({ query: { queued_backup: 'true' } } as never);

    expect(result.accepted).toBe(true);
  });

  it('does not acknowledge an empty backup while pending rows remain', async () => {
    const controller = new WebhooksController(
      {} as never,
      {
        runGhlGuard: vi.fn().mockResolvedValue({
          enabled: true,
          skipped: false,
          selected: 0,
          fetched: 0,
          inserted: 0,
          repaired: 0,
          failed: 0,
          queuedReplaySelected: 0,
          queuedReplayCompleted: 0,
          pendingQueuedReplayCount: 456,
        }),
      } as never,
      {} as never,
      {} as never,
    );

    const result = await controller.runGuardCron({ query: { queued_backup: 'true' } } as never);

    expect(result.accepted).toBe(false);
  });
});
