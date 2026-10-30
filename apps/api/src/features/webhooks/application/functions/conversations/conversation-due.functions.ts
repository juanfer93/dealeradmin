import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { findQueuedConversationDuplicate, findQueuedConversationIdentityDuplicate } from '../../../../leads/domain/lead-duplicate';
import { ConversationQueueService, type QueuedPauseDispatch } from './conversation-queue.service';
import { ConversationQualificationFunctions } from './conversation-qualification.functions';
import { ConversationReconciliationFunctions } from './conversation-reconciliation.functions';
import { DUE_CONVERSATION_BATCH_SIZE, GHL_SOURCE_CONFIG, PARTIAL_RECOVERY_MAX_ATTEMPTS, RECENT_AUTOMATION_WINDOW_MS, WAITING_WINDOW_MAX_ATTEMPTS, WAITING_WINDOW_RETRY_INTERVAL_MS } from './conversation-webhook.config';
import { clean } from './conversation-webhook.helpers';
import type { ConversationSnapshot, LocationSnapshot, DueConversationHealth, DueConversationResponse, SourceConfigMap, SourceKey } from './conversation-webhook.types';
import type { GhlGuardRunResult, GhlGuardService } from '../../ghl-guard.service';
import { configureWebhookTransactionSafety } from '../../transaction-safety';

const DUE_RELEASE_RETRY_ATTEMPTS = 3;
const DUE_RELEASE_RETRY_DELAY_MS = 100;

export class ConversationDueFunctions {
  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly qualification: ConversationQualificationFunctions,
    private readonly queueService: ConversationQueueService,
    private readonly reconciliation: ConversationReconciliationFunctions,
    private readonly sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
    private readonly guard?: GhlGuardService,
  ) {}

  async getDueConversationHealth(options: { recentOnly?: boolean; now?: Date } = {}): Promise<DueConversationHealth> {
    if (!this.dataSource) {
      if (process.env.NODE_ENV === 'test') {
        return {
          accepted: true,
          checkedAt: new Date().toISOString(),
          waitingWindowCount: 0,
          overdueCount: 0,
          missingNextAttemptCount: 0,
          oldestDueAt: null,
          partialRecoveryDueCount: 0,
          partialGuardContactIds: [],
          guardRetryContactIds: [],
          overdueConversations: [],
        };
      }
      throw new ServiceUnavailableException('Database connection is not available');
    }

    const recentOnly = options.recentOnly === true;
    const recentCutoff = new Date((options.now ?? new Date()).getTime() - RECENT_AUTOMATION_WINDOW_MS).toISOString();
    const recentPredicate = recentOnly
      ? ` AND COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $1::timestamptz`
      : '';
    const recentParams = recentOnly ? [recentCutoff] : [];
    const summary = await this.dataSource.query(
      `SELECT CURRENT_TIMESTAMP AS checked_at,
              COUNT(*) FILTER (WHERE status = 'waiting_window'${recentPredicate})::int AS waiting_window_count,
              COUNT(*) FILTER (
                WHERE status = 'waiting_window'
                  AND next_attempt_at IS NOT NULL
                  AND next_attempt_at <= CURRENT_TIMESTAMP
                  ${recentOnly ? 'AND COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $1::timestamptz' : ''}
              )::int AS overdue_count,
              COUNT(*) FILTER (
                WHERE status = 'waiting_window' AND next_attempt_at IS NULL
                  ${recentOnly ? 'AND COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $1::timestamptz' : ''}
              )::int AS missing_next_attempt_count,
              MIN(next_attempt_at) FILTER (
                WHERE status = 'waiting_window'
                  AND next_attempt_at IS NOT NULL
                  AND next_attempt_at <= CURRENT_TIMESTAMP
                  ${recentOnly ? 'AND COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $1::timestamptz' : ''}
              ) AS oldest_due_at,
              COUNT(*) FILTER (
                WHERE status = 'partial'
                  AND partial_recovery_enabled = true
                  AND partial_recovery_attempts < ${PARTIAL_RECOVERY_MAX_ATTEMPTS}
                  AND partial_recovery_next_attempt_at IS NOT NULL
                  AND partial_recovery_next_attempt_at <= CURRENT_TIMESTAMP
                  ${recentOnly ? 'AND COALESCE(last_message_at, ready_at, partial_recovery_started_at, created_at) >= $1::timestamptz' : ''}
              )::int AS partial_recovery_due_count,
              COALESCE((
                SELECT ARRAY_AGG(partial_guard.ghl_contact_id ORDER BY partial_guard.first_recovery_at)
                FROM (
                  SELECT partial_conversation.ghl_contact_id,
                         MIN(partial_conversation.partial_recovery_next_attempt_at) AS first_recovery_at
                  FROM conversations partial_conversation
                  WHERE partial_conversation.status = 'partial'
                    AND partial_conversation.partial_recovery_enabled = true
                    AND partial_conversation.partial_recovery_attempts < ${PARTIAL_RECOVERY_MAX_ATTEMPTS}
                    AND partial_conversation.ghl_contact_id IS NOT NULL
                    AND partial_conversation.partial_recovery_next_attempt_at IS NOT NULL
                    AND partial_conversation.partial_recovery_next_attempt_at <= CURRENT_TIMESTAMP
                    ${recentOnly ? 'AND COALESCE(partial_conversation.last_message_at, partial_conversation.ready_at, partial_conversation.partial_recovery_started_at, partial_conversation.created_at) >= $1::timestamptz' : ''}
                  GROUP BY partial_conversation.ghl_contact_id
                  ORDER BY first_recovery_at ASC
                  LIMIT ${DUE_CONVERSATION_BATCH_SIZE}
                ) partial_guard
              ), ARRAY[]::text[]) AS partial_guard_contact_ids,
              COALESCE((
                SELECT ARRAY_AGG(due_guard.ghl_contact_id ORDER BY due_guard.first_retry_at)
                FROM (
                  SELECT guard_log.ghl_contact_id, MIN(guard_log.next_retry_at) AS first_retry_at
                  FROM ghl_guard_logs guard_log
                  JOIN conversations guard_conversation ON guard_conversation.id = guard_log.conversation_id
                  WHERE guard_log.status = 'failed'
                    AND guard_log.next_retry_at IS NOT NULL
                    AND guard_log.next_retry_at <= CURRENT_TIMESTAMP
                    AND (guard_conversation.status <> 'partial'
                      OR (guard_conversation.partial_recovery_enabled = true
                        AND guard_conversation.partial_recovery_attempts < ${PARTIAL_RECOVERY_MAX_ATTEMPTS}
                        AND guard_conversation.partial_recovery_next_attempt_at IS NOT NULL
                        AND guard_conversation.partial_recovery_next_attempt_at <= CURRENT_TIMESTAMP))
                    ${recentOnly ? 'AND COALESCE(guard_conversation.last_message_at, guard_conversation.ready_at, guard_conversation.waiting_window_started_at, guard_conversation.created_at) >= $1::timestamptz' : ''}
                  GROUP BY guard_log.ghl_contact_id
                  ORDER BY first_retry_at ASC
                  LIMIT ${DUE_CONVERSATION_BATCH_SIZE}
                ) due_guard
              ), ARRAY[]::text[]) AS guard_retry_contact_ids
       FROM conversations`,
      recentParams,
    ) as Array<{
      checked_at: string | Date;
      waiting_window_count: number | string;
      overdue_count: number | string;
      missing_next_attempt_count: number | string;
      oldest_due_at: string | Date | null;
      partial_recovery_due_count: number | string;
      partial_guard_contact_ids: string[] | null;
      guard_retry_contact_ids: string[] | null;
    }>;
    const overdueConversations = await this.dataSource.query(
      `SELECT id, ghl_contact_id, next_attempt_at, waiting_window_attempts
       FROM conversations
       WHERE status = 'waiting_window'
         AND next_attempt_at IS NOT NULL
         AND next_attempt_at <= CURRENT_TIMESTAMP
         ${recentOnly ? 'AND COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $1::timestamptz' : ''}
       ORDER BY next_attempt_at ASC
       LIMIT ${recentOnly ? '$2' : '$1'}`,
      recentOnly ? [recentCutoff, DUE_CONVERSATION_BATCH_SIZE] : [DUE_CONVERSATION_BATCH_SIZE],
    ) as Array<{
      id: string;
      ghl_contact_id: string;
      next_attempt_at: string | Date;
      waiting_window_attempts: number | string | null;
    }>;
    const row = summary[0];
    const toIso = (value: string | Date | null): string | null => value === null ? null : new Date(value).toISOString();
    return {
      accepted: true,
      checkedAt: toIso(row?.checked_at ?? new Date())!,
      waitingWindowCount: Number(row?.waiting_window_count ?? 0),
      overdueCount: Number(row?.overdue_count ?? 0),
      missingNextAttemptCount: Number(row?.missing_next_attempt_count ?? 0),
      oldestDueAt: toIso(row?.oldest_due_at ?? null),
      partialRecoveryDueCount: Number(row?.partial_recovery_due_count ?? 0),
      partialGuardContactIds: Array.isArray(row?.partial_guard_contact_ids) ? row.partial_guard_contact_ids : [],
      guardRetryContactIds: Array.isArray(row?.guard_retry_contact_ids) ? row.guard_retry_contact_ids : [],
      overdueConversations: overdueConversations.map((conversation) => ({
        id: conversation.id,
        ghlContactId: conversation.ghl_contact_id,
        nextAttemptAt: toIso(conversation.next_attempt_at)!,
        waitingWindowAttempts: Number(conversation.waiting_window_attempts ?? 0),
      })),
    };
  }

  async processDueConversations(now: Date, options: { reconcileActive?: boolean; runGuard?: boolean; guardContactIds?: string[]; forceGuard?: boolean; dueContactIds?: string[]; recentOnly?: boolean } = {}): Promise<DueConversationResponse> {
    if (!this.dataSource) {
      if (process.env.NODE_ENV === 'test') return { accepted: true, processed: 0, advanced: 0, skipped: 0, remainingDue: 0, guardContactIds: [] };
      throw new ServiceUnavailableException('Database connection is not available');
    }
    // Release-only watchdog calls intentionally do not run the external GHL
    // Guard. Recover abandoned Guard rows here as audit hygiene so a failed
    // Neon/GHL close-out cannot leave a stale `running` lease blocking the
    // next cycle. This must never make durable cycle release fail.
    try {
      await this.guard?.recoverStaleState?.(now);
    } catch {
      // The Guard is additive and best-effort; due-cycle release remains
      // authoritative when its telemetry connection is unavailable.
    }
    const dueContactIds = [...new Set((options.dueContactIds ?? []).map((value) => value.trim()).filter(Boolean))];
    // Explicit contact repairs may handle historical incidents. Unattended
    // watchdog batches are limited to conversations with recent activity.
    const recentOnly = options.recentOnly === true && dueContactIds.length === 0;
    const recentCutoff = new Date(now.getTime() - RECENT_AUTOMATION_WINDOW_MS).toISOString();
    if (dueContactIds.length > 0) {
      await this.dataSource.query(
        `UPDATE conversations SET next_attempt_at = $1::timestamptz, updated_at = CURRENT_TIMESTAMP,
             waiting_window_attempts = GREATEST(waiting_window_attempts, 0),
             waiting_window_started_at = COALESCE(waiting_window_started_at, $1::timestamptz)
         WHERE status = 'waiting_window' AND next_attempt_at IS NULL AND ghl_contact_id = ANY($2::text[])`,
        [now.toISOString(), dueContactIds],
      );
    } else {
      await this.dataSource.query(
        `UPDATE conversations SET next_attempt_at = $1::timestamptz, updated_at = CURRENT_TIMESTAMP,
             waiting_window_attempts = GREATEST(waiting_window_attempts, 0),
             waiting_window_started_at = COALESCE(waiting_window_started_at, $1::timestamptz)
         WHERE status = 'waiting_window' AND next_attempt_at IS NULL
           ${recentOnly ? 'AND COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $2::timestamptz' : ''}`,
        recentOnly ? [now.toISOString(), recentCutoff] : [now.toISOString()],
      );
    }
    const due = dueContactIds.length > 0
      ? await this.dataSource.query(
        `SELECT c.id, c.ghl_contact_id FROM conversations c
         WHERE c.status = 'waiting_window' AND c.next_attempt_at IS NOT NULL AND c.next_attempt_at <= $1
           AND c.ghl_contact_id = ANY($3::text[])
         ORDER BY c.next_attempt_at ASC LIMIT $2`,
        [now.toISOString(), DUE_CONVERSATION_BATCH_SIZE, dueContactIds],
      ) as Array<{ id: string; ghl_contact_id: string }>
      : await this.dataSource.query(
        `SELECT c.id, c.ghl_contact_id FROM conversations c
         WHERE c.status = 'waiting_window' AND c.next_attempt_at IS NOT NULL AND c.next_attempt_at <= $1
           ${recentOnly ? 'AND COALESCE(c.last_message_at, c.ready_at, c.waiting_window_started_at, c.created_at) >= $3::timestamptz' : ''}
         ORDER BY c.next_attempt_at ASC LIMIT $2`,
        recentOnly ? [now.toISOString(), DUE_CONVERSATION_BATCH_SIZE, recentCutoff] : [now.toISOString(), DUE_CONVERSATION_BATCH_SIZE],
      ) as Array<{ id: string; ghl_contact_id: string }>;
    const guardContactIds = [...new Set(due.map((row) => row.ghl_contact_id).filter(Boolean))];
    let processed = 0;
    let advanced = 0;
    let skipped = 0;
    let guardResult: GhlGuardRunResult | undefined;
    let guardError: string | undefined;
    const queuedContactIds: string[] = [];
    const waitingContactIds: string[] = [];
    for (const row of due) {
      try {
        const release = await this.releaseDueConversationWithRetry(row.id, now);
        if (release.terminal) processed += 1;
        if (release.advanced) advanced += 1;
        else skipped += 1;
        if (release.terminal && row.ghl_contact_id) queuedContactIds.push(row.ghl_contact_id);
        else if (row.ghl_contact_id) waitingContactIds.push(row.ghl_contact_id);
      } catch {
        // One malformed conversation must not stop the remaining five-minute
        // cycles. Keep it visible as deferred so the caller can retry it.
        skipped += 1;
      }
    }
    const retryContactIds = [...new Set(options.guardContactIds ?? [])]
      .filter((contactId) => !waitingContactIds.includes(contactId) && !queuedContactIds.includes(contactId));

    // Release the durable five-minute cycle before calling GHL. A slow or
    // stale external request must never leave next_attempt_at overdue and
    // prevent the next cycle from advancing. Waiting rows get their normal
    // targeted repair after release; terminal rows get the fifth read as a
    // queued replay followed by the additional queued-cycle read.
    const mergeGuardResult = (next: GhlGuardRunResult | undefined): void => {
      if (!next) return;
      guardResult = guardResult
        ? {
            ...guardResult,
            enabled: guardResult.enabled && next.enabled,
            skipped: guardResult.skipped && next.skipped,
            selected: guardResult.selected + next.selected,
            fetched: guardResult.fetched + next.fetched,
            inserted: guardResult.inserted + next.inserted,
            repaired: guardResult.repaired + next.repaired,
            failed: guardResult.failed + next.failed,
            errors: [...(guardResult.errors ?? []), ...(next.errors ?? [])],
            queuedReplaySelected: next.queuedReplaySelected ?? guardResult.queuedReplaySelected,
            queuedReplayCompleted: next.queuedReplayCompleted ?? guardResult.queuedReplayCompleted,
            queuedReplayFailed: next.queuedReplayFailed ?? guardResult.queuedReplayFailed,
            pendingQueuedReplayCount: next.pendingQueuedReplayCount ?? guardResult.pendingQueuedReplayCount,
          }
        : next;
    };
    const runTargetedGuard = async (contactIds: string[], guardOptions: { force?: boolean; queuedOnly?: boolean }): Promise<void> => {
      if (options.runGuard === false || !this.guard || contactIds.length === 0) return;
      try {
        const result = await this.guard.run(new Date(), {
          contactIds: [...new Set(contactIds)],
          ...guardOptions,
          ...(recentOnly ? { recentOnly: true } : {}),
        });
        mergeGuardResult(result);
      } catch (error) {
        // The GHL guard is a repair/audit layer; it must never block due
        // release. The next scheduled cycle can retry the targeted contact.
        guardError = error instanceof Error ? error.name : 'GHL_GUARD_RUN_FAILED';
      }
    };

    await runTargetedGuard(waitingContactIds, { force: options.forceGuard === true });
    if (queuedContactIds.length > 0) {
      // The fifth waiting-window read is performed after the durable
      // transition, then one more targeted read is performed for the queued
      // handoff. The second read is allowed after queued replay count=1.
      await runTargetedGuard(queuedContactIds, { force: true, queuedOnly: true });
      await runTargetedGuard(queuedContactIds, { force: true });
    } else if (waitingContactIds.length === 0 && options.runGuard !== false && this.guard) {
      try {
        const result = await this.guard.run(new Date(), {
          contactIds: options.guardContactIds,
          force: options.forceGuard === true,
          ...(recentOnly ? { recentOnly: true } : {}),
        });
        mergeGuardResult(result);
      } catch (error) {
        guardError = error instanceof Error ? error.name : 'GHL_GUARD_RUN_FAILED';
      }
    }
    if (retryContactIds.length > 0 && options.runGuard !== false && this.guard) {
      await runTargetedGuard(retryContactIds, { force: true });
    }
    let remainingDue = 0;
    if (due.length >= DUE_CONVERSATION_BATCH_SIZE || skipped > 0) {
      const remainingRows = dueContactIds.length > 0
        ? await this.dataSource.query(
          `SELECT COUNT(*)::int AS count FROM conversations
           WHERE status = 'waiting_window' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1
             AND ghl_contact_id = ANY($2::text[])`,
          [now.toISOString(), dueContactIds],
        ) as Array<{ count: number | string }>
        : await this.dataSource.query(
          `SELECT COUNT(*)::int AS count FROM conversations
           WHERE status = 'waiting_window' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1
             ${recentOnly ? 'AND COALESCE(last_message_at, ready_at, waiting_window_started_at, created_at) >= $2::timestamptz' : ''}`,
          recentOnly ? [now.toISOString(), recentCutoff] : [now.toISOString()],
        ) as Array<{ count: number | string }>;
      remainingDue = Number(remainingRows?.[0]?.count ?? 0);
    }
    if (options.reconcileActive !== false) await this.reconciliation.reconcileActiveConversations(now);
    return {
      accepted: true,
      processed,
      advanced,
      skipped,
      remainingDue,
      guardContactIds,
      ...(guardResult ? { guard: guardResult } : {}),
      ...(guardError ? { guardError } : {}),
    };
  }

  private async releaseDueConversationWithRetry(id: string, now: Date): Promise<{ advanced: boolean; terminal: boolean }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= DUE_RELEASE_RETRY_ATTEMPTS; attempt += 1) {
      let terminal: boolean;
      try {
        terminal = await this.releaseDueConversation(id, now);
      } catch (error) {
        lastError = error;
        if (attempt < DUE_RELEASE_RETRY_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, DUE_RELEASE_RETRY_DELAY_MS));
          continue;
        }
        throw lastError;
      }
      if (terminal) return { advanced: true, terminal: true };

      const remaining = await this.dataSource!.query(
        `SELECT status, next_attempt_at FROM conversations WHERE id = $1`,
        [id],
      ) as Array<{ status: string; next_attempt_at: string | null }>;
      const row = remaining[0];
      const stillDue = row?.status === 'waiting_window'
        && row.next_attempt_at !== null
        && new Date(row.next_attempt_at).getTime() <= now.getTime();
      if (!stillDue) return { advanced: row !== undefined, terminal: false };
      if (attempt < DUE_RELEASE_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, DUE_RELEASE_RETRY_DELAY_MS));
      }
    }
    return { advanced: false, terminal: false };
  }

  private async releaseDueConversation(id: string, now: Date): Promise<boolean> {
    const runner = this.dataSource!.createQueryRunner();
    let queuedPauseEvent: QueuedPauseDispatch | null = null;
    await runner.connect();
    await runner.startTransaction();
    try {
      // A cancelled serverless request must not leave a transaction holding a
      // conversation row indefinitely. SKIP LOCKED below handles contention;
      // these guards clean up the connection if the request disappears after
      // PostgreSQL has executed a statement but before the client commits.
      await configureWebhookTransactionSafety(runner);
      const rows = await runner.query(
        `SELECT c.id, c.ghl_location_id, c.ghl_contact_id, c.ghl_conversation_id, c.qualification_snapshot, c.location_snapshot, c.ready_at,
                c.waiting_window_attempts,
                l.id AS lead_id, l.first_name, l.last_name
         FROM conversations c JOIN leads l ON l.id = c.lead_id
         WHERE c.id = $1 AND c.status = 'waiting_window' AND c.next_attempt_at <= $2
         FOR UPDATE SKIP LOCKED`,
        [id, now.toISOString()],
      ) as Array<{ id: string; ghl_location_id: string; ghl_contact_id: string; ghl_conversation_id: string; qualification_snapshot: ConversationSnapshot; location_snapshot: LocationSnapshot; ready_at: string | null; waiting_window_attempts: number | string | null; lead_id: string; first_name: string | null; last_name: string | null }>;
      if (!rows[0]) {
        await runner.rollbackTransaction();
        return false;
      }
      const row = rows[0];
      const queuedIdentityDuplicate = await findQueuedConversationIdentityDuplicate(runner, {
        dealerId: clean(row.qualification_snapshot.assigned_dealer_id),
        contactId: row.ghl_contact_id,
        phone: row.qualification_snapshot.phone,
        excludeConversationId: id,
      });
      if (queuedIdentityDuplicate) {
        await runner.query(`UPDATE conversations SET status = 'duplicate_ignored', next_attempt_at = NULL, waiting_window_attempts = 0, waiting_window_started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        await runner.commitTransaction();
        return false;
      }
      const configuredSource = Object.entries(this.sourceConfig).find(([, config]) => config.locationId === row.ghl_location_id)?.[0];
      if (!configuredSource) throw new BadRequestException(`Fuente GHL no configurada para la Location ID ${row.ghl_location_id}`);
      const source = configuredSource as SourceKey;
      const waitingWindowAttempts = Number(row.waiting_window_attempts ?? 0);
      const nextWaitingWindowAttempts = Math.min(waitingWindowAttempts + 1, WAITING_WINDOW_MAX_ATTEMPTS);
      if (nextWaitingWindowAttempts < WAITING_WINDOW_MAX_ATTEMPTS) {
        const nextAttemptAt = new Date(now.getTime() + WAITING_WINDOW_RETRY_INTERVAL_MS).toISOString();
        await runner.query(
          `UPDATE conversations
           SET status = 'waiting_window', next_attempt_at = $2::timestamptz,
               waiting_window_attempts = $4,
               waiting_window_started_at = COALESCE(waiting_window_started_at, $3::timestamptz),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id, nextAttemptAt, now.toISOString(), nextWaitingWindowAttempts],
        );
        await runner.commitTransaction();
        return false;
      }
      // The fifth due cycle is the terminal waiting-window backstop. A lead
      // must never be stranded in waiting_window because an optional
      // qualification/location detail is still incomplete; the queued phase
      // is the durable handoff that lets the downstream workflow continue.
      const terminalWaitingWindowCycle = nextWaitingWindowAttempts >= WAITING_WINDOW_MAX_ATTEMPTS;
      const dealer = await this.qualification.findSourceDealer(runner, row.ghl_location_id, source, row.qualification_snapshot.language, clean(row.qualification_snapshot.assigned_dealer_id) || undefined);
      const status = this.qualification.statusForConversation(row.qualification_snapshot, row.location_snapshot, dealer, source, now, 'due', row.ready_at, nextWaitingWindowAttempts);
      if (status.status !== 'ready' && !terminalWaitingWindowCycle) {
        await runner.query(
          `UPDATE conversations SET status = $2, next_attempt_at = $3,
             ready_at = CASE WHEN $2::varchar IN ('ready', 'waiting_window', 'queued') THEN COALESCE(ready_at, $4::timestamptz) ELSE ready_at END,
             waiting_window_attempts = CASE WHEN $2::varchar = 'waiting_window' THEN waiting_window_attempts ELSE 0 END,
             waiting_window_started_at = CASE WHEN $2::varchar = 'waiting_window' THEN COALESCE(waiting_window_started_at, $4::timestamptz) ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id, status.status, status.nextAttemptAt, now.toISOString()],
        );
        await runner.commitTransaction();
        return false;
      }
      const queuedDuplicate = await findQueuedConversationDuplicate(
        runner,
        dealer.id,
        row.qualification_snapshot.real_name || clean(`${row.first_name || ''} ${row.last_name || ''}`),
        row.qualification_snapshot.phone,
        id,
      );
      if (queuedDuplicate) {
        await runner.query(`UPDATE conversations SET status = 'duplicate_ignored', next_attempt_at = NULL, waiting_window_attempts = 0, waiting_window_started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        await runner.commitTransaction();
        return false;
      }
      await this.qualification.syncLeadDealer(runner, dealer, row.lead_id, row.qualification_snapshot, row.location_snapshot, source);
      await runner.query(`UPDATE conversations SET status = 'queued', next_attempt_at = NULL, waiting_window_attempts = $2, waiting_window_started_at = COALESCE(waiting_window_started_at, $3::timestamptz), updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, nextWaitingWindowAttempts, now.toISOString()]);
      queuedPauseEvent = await this.queueService.createQueuedPauseEvent(runner, 'waiting_window', 'queued', {
        conversationId: row.id,
        ghlConversationId: row.ghl_conversation_id,
        contactId: row.ghl_contact_id,
        locationId: row.ghl_location_id,
        leadId: row.lead_id,
        source,
        emittedAt: now,
      });
      await runner.commitTransaction();
      if (queuedPauseEvent) await this.queueService.dispatchQueuedPauseEvent(queuedPauseEvent);
      return true;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}
