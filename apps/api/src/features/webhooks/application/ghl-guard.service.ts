import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { GHL_SOURCE_CONFIG, RECENT_AUTOMATION_WINDOW_MS, RECONCILIATION_LOCATION_IDS } from './functions/conversations/conversation-webhook.config';
import type { SourceConfigMap } from './functions/conversations/conversation-webhook.types';
import { ConversationReconciliationFunctions } from './functions/conversations/conversation-reconciliation.functions';
import { GhlGuardPersistenceFunctions } from './functions/ghl-guard/ghl-guard-persistence.functions';
import { GhlGuardRetryFunctions } from './functions/ghl-guard/ghl-guard-retry.functions';
import type { GhlGuardClientPort, GhlGuardFailure, GhlGuardRunResult, GhlGuardSkipReason, GuardConversationRow } from './functions/ghl-guard/ghl-guard.types';
import {
  ghlGuardConcurrency,
  GHL_GUARD_LOCK_KEY,
  ghlGuardEnabled,
  ghlGuardIntervalMs,
  ghlGuardLeaseMs,
  ghlGuardRetryDelayMs,
} from './ghl-guard.config';
import { GhlGuardClient } from './ghl-guard.client';
import { GhlGuardRowProcessor } from './functions/ghl-guard/ghl-guard-row-processor.functions';
import { selectGuardConversations } from './functions/ghl-guard/ghl-guard-selection.functions';
export type { GhlGuardFailure, GhlGuardRunResult, GhlGuardSkipReason } from './functions/ghl-guard/ghl-guard.types';

@Injectable()
export class GhlGuardService {
  private readonly logger = new Logger(GhlGuardService.name);
  private readonly persistence: GhlGuardPersistenceFunctions;
  private readonly retryFunctions: GhlGuardRetryFunctions;
  private readonly rowProcessor: GhlGuardRowProcessor;
  private running = false;
  private lastRunAt = 0;
  private readonly pendingContactIds = new Set<string>();
  private pendingTargetedRetry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dataSource: DataSource | undefined,
    reconciliation: ConversationReconciliationFunctions,
    sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
    client: GhlGuardClientPort = new GhlGuardClient(),
  ) {
    this.persistence = new GhlGuardPersistenceFunctions(dataSource);
    this.retryFunctions = new GhlGuardRetryFunctions(
      dataSource,
      sourceConfig,
      (contactIds) => this.enqueuePendingContactIds(contactIds),
    );
    this.rowProcessor = new GhlGuardRowProcessor(
      dataSource, reconciliation, sourceConfig, client, () => this.persistence, this.retryFunctions,
      (contactIds) => this.enqueuePendingContactIds(contactIds),
    );
  }

  /**
   * Clean up abandoned Guard rows without making the due-cycle release depend
   * on a successful external GHL read. This is intentionally best-effort at
   * the caller boundary: a Neon connection failure must not stop a waiting
   * conversation from advancing to its next durable cycle.
   */
  async recoverStaleState(now = new Date()): Promise<void> {
    await this.persistence.recoverStaleLogs(now);
    await this.persistence.recoverStaleQueuedReplayClaims(now);
  }

  async run(now = new Date(), options: { contactIds?: string[]; force?: boolean; queuedOnly?: boolean; recentOnly?: boolean; allowSentRepair?: boolean } = {}): Promise<GhlGuardRunResult> {
    const empty: GhlGuardRunResult = { enabled: ghlGuardEnabled(), skipped: true, selected: 0, fetched: 0, inserted: 0, repaired: 0, failed: 0 };
    const runId = randomUUID();
    const contactIds = [...new Set((options.contactIds ?? []).map((value) => value.trim()).filter(Boolean))];
    const queuedOnly = options.queuedOnly === true;
    const recentOnly = options.recentOnly === true;
    const recentCutoff = new Date(now.getTime() - RECENT_AUTOMATION_WINDOW_MS).toISOString();
    const skip = async (reason: GhlGuardSkipReason): Promise<GhlGuardRunResult> => {
      const target = contactIds.length > 0 ? ` contacts=${contactIds.join(',')}` : '';
      this.logger.warn(`GHL guard skipped reason=${reason}${target}`);
      await this.persistence.logSkip(runId, reason, contactIds, empty.enabled);
      return { ...empty, skipReason: reason };
    };
    if (!empty.enabled) return skip('disabled');
    if (!this.dataSource) return skip('no_database');
    const targeted = contactIds.length > 0;
    // An automatic due cycle may also target contact IDs. Only the explicit
    // manual repair flag may bypass the sent identity lock.
    const allowSentRepair = options.allowSentRepair === true && targeted && !queuedOnly;
    if (this.running) {
      this.enqueuePendingContactIds(contactIds);
      return skip('already_running');
    }
    if (!targeted && !options.force && now.getTime() - this.lastRunAt < ghlGuardIntervalMs()) return skip('in_memory_interval');
    this.running = true;

    const result: GhlGuardRunResult = { ...empty, skipped: false };
    let lockRunner: QueryRunner | null = null;
    let leaseAcquired = false;
    try {
      // A previous serverless invocation can die before its finally block
      // releases the lease. Recover only rows whose own lease/age is already
      // stale before attempting the global lease, so a scheduler cycle that
      // observes a busy global lease still cleans up abandoned work.
      await this.recoverStaleState(now);
      lockRunner = this.dataSource.createQueryRunner();
      await lockRunner.connect();
      const leaseRows = await lockRunner.query(
        `INSERT INTO ghl_guard_leases
           (lease_key, owner_id, acquired_at, lease_expires_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP,
                 CURRENT_TIMESTAMP + ($3::integer * INTERVAL '1 millisecond'),
                 CURRENT_TIMESTAMP)
         ON CONFLICT (lease_key) DO UPDATE
           SET owner_id = EXCLUDED.owner_id,
               acquired_at = EXCLUDED.acquired_at,
               lease_expires_at = EXCLUDED.lease_expires_at,
               updated_at = EXCLUDED.updated_at
         WHERE ghl_guard_leases.lease_expires_at <= CURRENT_TIMESTAMP
         RETURNING owner_id`,
        [GHL_GUARD_LOCK_KEY, runId, ghlGuardLeaseMs()],
      ) as Array<{ owner_id: string }>;
      leaseAcquired = leaseRows.length > 0;
      if (!leaseAcquired) {
        const skipped = { ...result, skipped: true, skipReason: 'advisory_lock' as const };
        this.logger.warn('GHL guard skipped reason=advisory_lock');
        this.enqueuePendingContactIds(contactIds);
        await this.persistence.logSkip(runId, 'advisory_lock', contactIds, empty.enabled);
        return skipped;
      }
      // Only mark the interval after this invocation actually owns the lease.
      // A contention skip must not suppress the next scheduler attempt in the
      // same warm instance.
      this.lastRunAt = now.getTime();
      await this.recoverStaleState(now);
      const rows = await selectGuardConversations(lockRunner, { targeted, contactIds, allowSentRepair, recentOnly, recentCutoff, queuedOnly });
      result.selected = rows.length;
      if (queuedOnly) {
        result.queuedReplaySelected = rows.length;
        result.queuedReplayCompleted = 0;
        result.queuedReplayFailed = 0;
      }
      // Rows belonging to one explicitly targeted contact must be serialized:
      // an older conversation may contain the name that repairs a later queued
      // conversation sharing the same lead.
      const concurrency = targeted ? 1 : Math.min(ghlGuardConcurrency(), rows.length);
      for (let offset = 0; offset < rows.length; offset += concurrency) {
        const batch = rows.slice(offset, offset + concurrency);
        await Promise.all(batch.map((row) => this.rowProcessor.processRow(row, runId, now, result, targeted, queuedOnly, allowSentRepair)));
      }
      if (queuedOnly) result.pendingQueuedReplayCount = await this.countPendingQueuedReplays();
      return result;
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : 'GHL_GUARD_RUN_FAILED';
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.persistence.log(runId, null, 'failed', { errorCode, errorMessage, targetContactIds: contactIds });
      this.recordFailure(result, null, errorCode, errorMessage);
      return result;
    } finally {
      if (lockRunner) {
        if (leaseAcquired) {
          try {
            await lockRunner.query(
              `DELETE FROM ghl_guard_leases WHERE lease_key = $1 AND owner_id = $2`,
              [GHL_GUARD_LOCK_KEY, runId],
            );
          } catch { /* best effort */ }
        }
        await lockRunner.release();
      }
      this.running = false;
      this.schedulePendingTargetedRun();
    }
  }

  private enqueuePendingContactIds(contactIds: string[]): void {
    for (const contactId of contactIds) this.pendingContactIds.add(contactId);
    this.schedulePendingTargetedRun();
  }

  private schedulePendingTargetedRun(): void {
    if (this.pendingContactIds.size === 0 || this.pendingTargetedRetry) return;
    const retry = setTimeout(() => {
      this.pendingTargetedRetry = null;
      if (this.pendingContactIds.size === 0) return;
      const contactIds = [...this.pendingContactIds];
      this.pendingContactIds.clear();
      void this.run(new Date(), { contactIds, force: true }).then((result) => {
        if (result.skipped && (result.skipReason === 'already_running' || result.skipReason === 'advisory_lock')) {
          this.enqueuePendingContactIds(contactIds);
        }
      }).catch((error) => {
        this.logger.warn(`Deferred targeted GHL guard failed: ${error instanceof Error ? error.message : String(error)}`);
        this.enqueuePendingContactIds(contactIds);
      });
    }, ghlGuardRetryDelayMs());
    this.pendingTargetedRetry = retry;
    const unref = (retry as unknown as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(retry);
  }

  private async countPendingQueuedReplays(): Promise<number> {
    if (!this.dataSource) return 0;
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM conversations
       WHERE status = 'queued'
         AND queued_guard_replay_count = 0
         AND ghl_location_id = ANY($1::text[])`,
      [RECONCILIATION_LOCATION_IDS],
    ) as Array<{ count: number | string }>;
    return Number(rows[0]?.count ?? 0);
  }


  private recordFailure(result: GhlGuardRunResult, row: GuardConversationRow | null, errorCode: string, errorMessage?: string): void {
    result.failed += 1;
    const failure: GhlGuardFailure = {
      conversationId: row?.id ?? null,
      ghlLocationId: row?.ghl_location_id ?? null,
      ghlContactId: row?.ghl_contact_id ?? null,
      errorCode,
    };
    if (errorMessage) failure.errorMessage = errorMessage.slice(0, 500);
    result.errors = [...(result.errors ?? []), failure];
  }
}
