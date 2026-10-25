import { describe, expect, it, vi } from 'vitest';
import { WebhooksController } from '../../presentation/webhooks.controller';

describe('WebhooksController queued Guard backup', () => {
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
    });
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
