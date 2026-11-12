import { describe, expect, it, vi } from 'vitest';
import { selectGuardConversations } from '../../application/functions/ghl-guard/ghl-guard-selection.functions';
import { GHL_SOURCE_CONFIG } from '../../application/functions/conversations/conversation-webhook.config';
import { ghlGuardIntervalMs, ghlGuardQueuedRefreshWindowMs, ghlGuardStaleLogMs } from '../../application/ghl-guard.config';

describe('selectGuardConversations queued refresh', () => {
  it('selects a queued contact again after recent activity and the refresh interval', async () => {
    const query = vi.fn(async () => []);
    await selectGuardConversations({ query } as never, {
      targeted: false,
      contactIds: [],
      allowSentRepair: false,
      recentOnly: true,
      recentCutoff: '2026-11-12T00:00:00.000Z',
      queuedOnly: true,
    });

    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('c.queued_guard_replay_count = 0');
    expect(sql).toContain('c.last_message_at >= CURRENT_TIMESTAMP - ($4::integer * INTERVAL');
    expect(sql).toContain('last_guard.created_at <= CURRENT_TIMESTAMP - ($5::integer * INTERVAL');
    expect(sql).toContain('COALESCE(c.last_message_at, c.ready_at, c.created_at) >= $6::timestamptz');
    expect(parameters).toEqual([
      expect.any(Number),
      Object.values(GHL_SOURCE_CONFIG).map((source) => source.locationId).filter((value, index, values) => values.indexOf(value) === index),
      ghlGuardStaleLogMs(),
      ghlGuardQueuedRefreshWindowMs(),
      ghlGuardIntervalMs(),
      '2026-11-12T00:00:00.000Z',
    ]);
  });
});
