import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { GHL_SOURCE_CONFIG, RECONCILIATION_LOCATION_IDS } from './functions/conversations/conversation-webhook.config';
import type { SourceConfigMap, SourceKey } from './functions/conversations/conversation-webhook.types';
import { ConversationReconciliationFunctions } from './functions/conversations/conversation-reconciliation.functions';
import { needsConversationLookup, sourceForLocation, isConversationIdentityConflict } from './functions/ghl-guard/ghl-guard.helpers';
import { GhlGuardPersistenceFunctions } from './functions/ghl-guard/ghl-guard-persistence.functions';
import { GhlGuardRetryFunctions } from './functions/ghl-guard/ghl-guard-retry.functions';
import type {
  GhlGuardClientPort,
  GhlGuardFailure,
  GhlGuardRunResult,
  GhlGuardSkipReason,
  GuardConversationRow,
} from './functions/ghl-guard/ghl-guard.types';
import {
  ghlGuardBatchSize,
  ghlGuardConcurrency,
  ghlGuardConversationTimeoutMs,
  GHL_GUARD_LOCK_KEY,
  ghlGuardEnabled,
  ghlGuardIntervalMs,
  ghlGuardLeaseMs,
  ghlGuardRetryDelayMs,
  ghlGuardStaleLogMs,
  ghlGuardTimeoutMs,
  GHL_GUARD_TOKEN_ENV_BY_SOURCE,
} from './ghl-guard.config';
import { GhlGuardClient } from './ghl-guard.client';
import { completedFieldsBetween } from './ghl-guard-audit';
export type { GhlGuardFailure, GhlGuardRunResult, GhlGuardSkipReason } from './functions/ghl-guard/ghl-guard.types';

@Injectable()
export class GhlGuardService {
  private readonly logger = new Logger(GhlGuardService.name);
  private readonly persistence: GhlGuardPersistenceFunctions;
  private readonly retryFunctions: GhlGuardRetryFunctions;
  private running = false;
  private lastRunAt = 0;
  private readonly pendingContactIds = new Set<string>();
  private pendingTargetedRetry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly reconciliation: ConversationReconciliationFunctions,
    private readonly sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
    private readonly client: GhlGuardClientPort = new GhlGuardClient(),
  ) {
    this.persistence = new GhlGuardPersistenceFunctions(dataSource);
    this.retryFunctions = new GhlGuardRetryFunctions(
      dataSource,
      sourceConfig,
      (contactIds) => this.enqueuePendingContactIds(contactIds),
    );
  }

  async run(now = new Date(), options: { contactIds?: string[]; force?: boolean; queuedOnly?: boolean } = {}): Promise<GhlGuardRunResult> {
    const empty: GhlGuardRunResult = { enabled: ghlGuardEnabled(), skipped: true, selected: 0, fetched: 0, inserted: 0, repaired: 0, failed: 0 };
    const runId = randomUUID();
    const contactIds = [...new Set((options.contactIds ?? []).map((value) => value.trim()).filter(Boolean))];
    const queuedOnly = options.queuedOnly === true;
    const skip = async (reason: GhlGuardSkipReason): Promise<GhlGuardRunResult> => {
      const target = contactIds.length > 0 ? ` contacts=${contactIds.join(',')}` : '';
      this.logger.warn(`GHL guard skipped reason=${reason}${target}`);
      await this.persistence.logSkip(runId, reason, contactIds, empty.enabled);
      return { ...empty, skipReason: reason };
    };
    if (!empty.enabled) return skip('disabled');
    if (!this.dataSource) return skip('no_database');
    const targeted = contactIds.length > 0;
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
      await this.persistence.recoverStaleLogs(now);
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
      await this.persistence.recoverStaleLogs(now);
      const rows = await lockRunner.query(
        targeted
          ? `SELECT id, ghl_location_id, ghl_contact_id, ghl_conversation_id, status
         FROM conversations
         LEFT JOIN LATERAL (
           SELECT latest_guard.created_at
           FROM ghl_guard_logs latest_guard
           WHERE latest_guard.conversation_id = conversations.id
           ORDER BY latest_guard.created_at DESC
           LIMIT 1
         ) last_guard ON TRUE
         LEFT JOIN LATERAL (
           SELECT retry_guard.next_retry_at
           FROM ghl_guard_logs retry_guard
           WHERE retry_guard.conversation_id = conversations.id
             AND retry_guard.status = 'failed'
             AND retry_guard.next_retry_at IS NOT NULL
             AND retry_guard.next_retry_at <= CURRENT_TIMESTAMP
           ORDER BY retry_guard.next_retry_at ASC, retry_guard.created_at ASC
           LIMIT 1
         ) due_retry ON TRUE
         WHERE status NOT IN ('sent', 'ignored_channel', 'stale_phone_ignored')
           AND ghl_location_id = ANY($2::text[])
           AND ghl_contact_id = ANY($3::text[])
           ${queuedOnly ? "AND status = 'queued' AND queued_guard_replay_count = 0" : ''}
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs active_guard
             WHERE active_guard.conversation_id = conversations.id
               AND active_guard.status IN ('pending', 'running')
               AND COALESCE(active_guard.lease_expires_at, active_guard.started_at, active_guard.scheduled_at) > CURRENT_TIMESTAMP
           )
         ORDER BY CASE WHEN due_retry.next_retry_at IS NOT NULL THEN 0 ELSE 1 END,
                  due_retry.next_retry_at ASC NULLS LAST,
                  CASE status WHEN 'duplicate_ignored' THEN 0 WHEN 'partial' THEN 1 WHEN 'waiting_window' THEN 2 WHEN 'stale_phone_ignored' THEN 3 WHEN 'queued' THEN 4 ELSE 5 END,
                  last_guard.created_at NULLS FIRST,
                  last_message_at DESC NULLS LAST,
                  updated_at DESC
         LIMIT $1`
          : queuedOnly
          ? `SELECT id, ghl_location_id, ghl_contact_id, ghl_conversation_id, status
         FROM conversations
         LEFT JOIN LATERAL (
           SELECT latest_guard.created_at
           FROM ghl_guard_logs latest_guard
           WHERE latest_guard.conversation_id = conversations.id
           ORDER BY latest_guard.created_at DESC
           LIMIT 1
         ) last_guard ON TRUE
         WHERE status = 'queued' AND queued_guard_replay_count = 0
           AND (queued_guard_replay_claimed_at IS NULL
             OR queued_guard_replay_claimed_at <= CURRENT_TIMESTAMP - ($3::integer * INTERVAL '1 millisecond'))
           AND ghl_location_id = ANY($2::text[])
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs active_guard
             WHERE active_guard.conversation_id = conversations.id
               AND active_guard.status IN ('pending', 'running')
               AND COALESCE(active_guard.lease_expires_at, active_guard.started_at, active_guard.scheduled_at) > CURRENT_TIMESTAMP
           )
         ORDER BY last_guard.created_at NULLS FIRST, updated_at DESC
         LIMIT $1`
          : `SELECT id, ghl_location_id, ghl_contact_id, ghl_conversation_id, status
         FROM conversations
         LEFT JOIN LATERAL (
           SELECT latest_guard.created_at
           FROM ghl_guard_logs latest_guard
           WHERE latest_guard.conversation_id = conversations.id
           ORDER BY latest_guard.created_at DESC
           LIMIT 1
         ) last_guard ON TRUE
         LEFT JOIN LATERAL (
           SELECT retry_guard.next_retry_at
           FROM ghl_guard_logs retry_guard
           WHERE retry_guard.conversation_id = conversations.id
             AND retry_guard.status = 'failed'
             AND retry_guard.next_retry_at IS NOT NULL
             AND retry_guard.next_retry_at <= CURRENT_TIMESTAMP
           ORDER BY retry_guard.next_retry_at ASC, retry_guard.created_at ASC
           LIMIT 1
         ) due_retry ON TRUE
         WHERE (status NOT IN ('queued', 'sent', 'duplicate_ignored', 'ignored_channel', 'stale_phone_ignored')
            OR (status = 'queued' AND queued_guard_replay_count = 0
              AND (queued_guard_replay_claimed_at IS NULL
                OR queued_guard_replay_claimed_at <= CURRENT_TIMESTAMP - ($3::integer * INTERVAL '1 millisecond'))))
           AND ghl_location_id = ANY($2::text[])
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs active_guard
             WHERE active_guard.conversation_id = conversations.id
               AND active_guard.status IN ('pending', 'running')
               AND COALESCE(active_guard.lease_expires_at, active_guard.started_at, active_guard.scheduled_at) > CURRENT_TIMESTAMP
           )
           AND NOT EXISTS (
             SELECT 1 FROM ghl_guard_logs retry_guard
             WHERE retry_guard.conversation_id = conversations.id
               AND retry_guard.status = 'failed'
               AND retry_guard.next_retry_at > CURRENT_TIMESTAMP
           )
         ORDER BY CASE WHEN due_retry.next_retry_at IS NOT NULL THEN 0 ELSE 1 END,
                  due_retry.next_retry_at ASC NULLS LAST,
                  last_guard.created_at NULLS FIRST,
                  last_message_at DESC NULLS LAST,
                  updated_at DESC
         LIMIT $1`,
        targeted
          ? [Math.max(ghlGuardBatchSize(), Math.min(contactIds.length * 3, 10)), RECONCILIATION_LOCATION_IDS, contactIds]
          : [ghlGuardBatchSize(), RECONCILIATION_LOCATION_IDS, ghlGuardStaleLogMs()],
      ) as GuardConversationRow[];
      result.selected = rows.length;
      // Rows belonging to one explicitly targeted contact must be serialized:
      // an older conversation may contain the name that repairs a later queued
      // conversation sharing the same lead.
      const concurrency = targeted ? 1 : Math.min(ghlGuardConcurrency(), rows.length);
      for (let offset = 0; offset < rows.length; offset += concurrency) {
        const batch = rows.slice(offset, offset + concurrency);
        await Promise.all(batch.map((row) => this.processRow(row, runId, now, result, targeted, queuedOnly)));
      }
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

  private async findLocalCanonicalConversation(row: GuardConversationRow): Promise<{ id: string; ghl_conversation_id: string; status: string } | null> {
    if (!this.dataSource) return null;
    const rows = await this.dataSource.query(
      `SELECT canonical.id, canonical.ghl_conversation_id, canonical.status
       FROM conversations canonical
       WHERE canonical.ghl_location_id = $1
         AND canonical.ghl_contact_id = $2
         AND canonical.id <> $3
         AND canonical.ghl_conversation_id IS NOT NULL
         AND canonical.ghl_conversation_id NOT LIKE 'contact:%'
       ORDER BY canonical.last_message_at DESC NULLS LAST, canonical.updated_at DESC
       LIMIT 1`,
      [row.ghl_location_id, row.ghl_contact_id, row.id],
    ) as Array<{ id: string; ghl_conversation_id: string; status: string }>;
    const canonical = rows[0];
    return canonical?.ghl_conversation_id ? canonical : null;
  }

  private async processRow(row: GuardConversationRow, runId: string, now: Date, result: GhlGuardRunResult, targeted = false, queuedOnly = false): Promise<void> {
    let logId: string | null = null;
    let source: SourceKey | undefined;
    let queuedReplayClaimed = false;
    let queuedReplayCompleted = false;
    const startedAt = new Date();
    try {
      logId = await this.persistence.createLog(runId, row, 'pending', now);
      if (!logId) {
        this.recordFailure(result, row, 'GHL_GUARD_LOG_CREATE_NOT_PERSISTED');
        return;
      }
      await this.persistence.updateLog(logId, 'running', { startedAt });
      const deadlineAt = Date.now() + ghlGuardConversationTimeoutMs();
      source = sourceForLocation(this.sourceConfig, row.ghl_location_id);
      if (!source) {
        this.recordFailure(result, row, 'SOURCE_NOT_CONFIGURED');
        await this.updateLog(logId, 'failed', { errorCode: 'SOURCE_NOT_CONFIGURED', finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
        return;
      }
      const token = process.env[GHL_GUARD_TOKEN_ENV_BY_SOURCE[source]]?.trim();
      if (!token) {
        this.recordFailure(result, row, 'GHL_TOKEN_MISSING');
        await this.updateLog(logId, 'failed', { errorCode: 'GHL_TOKEN_MISSING', source, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
        return;
      }
      if (await this.retryFunctions.isSourceCircuitOpen(source)) {
        this.enqueuePendingContactIds([row.ghl_contact_id]);
        this.recordFailure(result, row, 'GHL_CIRCUIT_OPEN', 'GHL source circuit is open; retrying the contact later');
        await this.persistence.updateLog(logId, 'skipped', {
          source,
          errorCode: 'GHL_CIRCUIT_OPEN',
          skipReason: 'circuit_open',
          requestTimeoutMs: ghlGuardTimeoutMs(),
          circuitState: 'open',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        });
        return;
      }
      if (row.status === 'queued') {
        const allowQueuedReplay = targeted || queuedOnly;
        const queuedReplay = await this.persistence.claimQueuedReplay(row.id, allowQueuedReplay);
        if (!queuedReplay.allowed) {
          await this.persistence.updateLog(logId, 'skipped', {
            source,
            skipReason: 'queued_replay_already_consumed',
            queuedReplay: true,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
          });
          return;
        }
        queuedReplayClaimed = queuedReplay.claimed;
        if (queuedReplayClaimed) await this.persistence.updateLog(logId, 'running', { queuedReplay: true });
      }
      let effectiveRow = row;
      let syntheticConversationId: string | null = null;
      let conversationId = row.ghl_conversation_id?.trim() ?? '';
      let lookupMetadata: Record<string, unknown> = {};
      if (needsConversationLookup(row.ghl_conversation_id)) {
        const localCanonical = await this.findLocalCanonicalConversation(row);
        if (localCanonical) {
          conversationId = localCanonical.ghl_conversation_id;
          syntheticConversationId = row.id;
          effectiveRow = {
            ...row,
            id: localCanonical.id,
            ghl_conversation_id: localCanonical.ghl_conversation_id,
            status: localCanonical.status,
          };
          lookupMetadata = {
            conversationLookup: {
              resolved: true,
              source: 'local_canonical_sibling',
              localConversationId: localCanonical.id,
            },
          };
        }
      }
      if (needsConversationLookup(row.ghl_conversation_id) && !syntheticConversationId) {
        if (!this.client.searchConversationByContact) {
          this.recordFailure(result, row, 'GHL_CONVERSATION_LOOKUP_UNAVAILABLE');
          await this.persistence.updateLog(logId, 'failed', { errorCode: 'GHL_CONVERSATION_LOOKUP_UNAVAILABLE', source, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
          return;
        }
        const lookup = await this.client.searchConversationByContact(token, row.ghl_location_id, row.ghl_contact_id, { deadlineAt });
        lookupMetadata = {
          conversationLookup: {
            requestPath: lookup.requestPath,
            httpStatus: lookup.status,
            resolved: Boolean(lookup.data?.conversation?.id),
            attemptCount: lookup.attemptCount ?? null,
            elapsedMs: lookup.elapsedMs ?? null,
          },
        };
        if (!lookup.ok || !lookup.data?.conversation?.id) {
          const errorCode = lookup.errorCode || 'GHL_CONVERSATION_NOT_FOUND';
          this.recordFailure(result, row, errorCode);
          this.retryFunctions.scheduleTransientRetry(row, errorCode, source);
          await this.persistence.updateLog(logId, 'failed', {
            errorCode,
            source,
            httpStatus: lookup.status,
            requestPath: lookup.requestPath,
            responsePayload: lookup.responsePayload,
            requestAttempts: lookup.attemptCount,
            requestElapsedMs: lookup.elapsedMs,
            requestTimeoutMs: ghlGuardTimeoutMs(),
            circuitState: this.retryFunctions.circuitState(source),
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            ...lookupMetadata,
          });
          return;
        }
        conversationId = lookup.data.conversation.id;
        try {
          await this.dataSource!.query(
            `UPDATE conversations
             SET ghl_conversation_id = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND (ghl_conversation_id IS NULL OR ghl_conversation_id LIKE 'contact:%')`,
            [row.id, conversationId],
          );
        } catch (error) {
          if (!isConversationIdentityConflict(error)) throw error;
          const existingConversation = await this.dataSource!.query(
            `SELECT id, status
             FROM conversations
             WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3
             LIMIT 1`,
            [row.ghl_location_id, row.ghl_contact_id, conversationId],
          ) as Array<{ id: string; status: string }>;
          if (!existingConversation[0]) throw error;
          syntheticConversationId = row.id;
          effectiveRow = { ...row, id: existingConversation[0].id, ghl_conversation_id: conversationId, status: existingConversation[0].status };
        }
        if (effectiveRow.id === row.id) effectiveRow = { ...row, ghl_conversation_id: conversationId };
      }
      const fetched = await this.client.listMessages(token, conversationId, { deadlineAt });
      if (!fetched.ok || !fetched.data) {
        const errorCode = fetched.errorCode || 'GHL_MESSAGES_READ_FAILED';
        this.recordFailure(result, row, errorCode);
        this.retryFunctions.scheduleTransientRetry(row, errorCode, source);
        await this.persistence.updateLog(logId, 'failed', {
          errorCode,
          source,
          httpStatus: fetched.status,
          requestPath: fetched.requestPath,
          responsePayload: fetched.responsePayload,
          requestAttempts: fetched.attemptCount,
          requestElapsedMs: fetched.elapsedMs,
          requestTimeoutMs: ghlGuardTimeoutMs(),
          circuitState: this.retryFunctions.circuitState(source),
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          ...lookupMetadata,
        });
        return;
      }
      result.fetched += fetched.data.messages.length;
      const allowQueuedReplay = targeted || queuedOnly;
      const persisted = await this.persistence.persistMessages(effectiveRow, fetched.data.messages, allowQueuedReplay);
      if (persisted.skipped) {
        await this.persistence.updateLog(logId, 'skipped', {
          source,
          fetchedMessages: fetched.data.messages.length,
          responsePayload: fetched.data.responsePayload,
          httpStatus: fetched.status,
          requestPath: fetched.requestPath,
          pages: fetched.data.pages,
          truncated: fetched.data.truncated,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          ...lookupMetadata,
        });
        return;
      }
      result.inserted += persisted.inserted;
      result.repaired += persisted.repaired;
      const mergedMessages = syntheticConversationId && syntheticConversationId !== effectiveRow.id
        ? await this.persistence.mergeSyntheticConversationMessages(syntheticConversationId, effectiveRow.id)
        : 0;
      const leadMetadataBefore = await this.persistence.readLeadMetadata(effectiveRow.id);
      if (targeted || queuedOnly) {
        await this.reconciliation.reconcileConversation(effectiveRow.id, new Date(), true, true, true, false);
      } else {
        await this.reconciliation.reconcileConversation(effectiveRow.id, new Date(), true, true, false, false);
      }
      // A targeted replay can discover that a synthetic local conversation
      // maps to an already-canonical GHL conversation. Reconcile the local
      // row as well so its queued snapshot receives the same corrected lead
      // evidence instead of remaining on the stale profile label.
      if (syntheticConversationId && syntheticConversationId !== effectiveRow.id) {
        await this.dataSource!.query(
          `UPDATE conversations synthetic
           SET qualification_snapshot = canonical.qualification_snapshot,
               location_snapshot = canonical.location_snapshot,
               updated_at = CURRENT_TIMESTAMP
           FROM conversations canonical
           WHERE synthetic.id = $1 AND canonical.id = $2`,
          [syntheticConversationId, effectiveRow.id],
        );
        await this.reconciliation.reconcileConversation(syntheticConversationId, new Date(), true, true, true, false);
      }
      const leadMetadataAfter = await this.persistence.readLeadMetadata(effectiveRow.id);
      const completedFields = completedFieldsBetween(leadMetadataBefore, leadMetadataAfter);
      if (syntheticConversationId && syntheticConversationId !== effectiveRow.id) {
        await this.dataSource!.query(
          `UPDATE conversations
           SET status = 'duplicate_ignored', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status NOT IN ('queued', 'sent', 'duplicate_ignored', 'ignored_channel', 'stale_phone_ignored')`,
          [syntheticConversationId],
        );
      }
      this.retryFunctions.resetSourceCircuit(source);
      if (queuedReplayClaimed) {
        const completed = await this.persistence.completeQueuedReplay(row.id);
        if (!completed) {
          throw new Error('GHL_GUARD_QUEUED_REPLAY_COMPLETION_NOT_PERSISTED');
        }
        queuedReplayCompleted = true;
      }
      await this.persistence.updateLog(logId, 'succeeded', {
        source,
        fetchedMessages: fetched.data.messages.length,
        insertedMessages: persisted.inserted,
        repairedMessages: persisted.repaired,
        responsePayload: fetched.data.responsePayload,
        requestAttempts: fetched.attemptCount,
        requestElapsedMs: fetched.elapsedMs,
        requestTimeoutMs: ghlGuardTimeoutMs(),
        circuitState: 'closed',
        httpStatus: fetched.status,
        requestPath: fetched.requestPath,
        pages: fetched.data.pages,
        truncated: fetched.data.truncated,
        reconciled: true,
        leadMetadata: leadMetadataAfter,
        completedFields,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        ...(mergedMessages > 0 ? { mergedMessages } : {}),
        ...lookupMetadata,
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : 'GHL_GUARD_CONVERSATION_FAILED';
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.recordFailure(result, row, errorCode, errorMessage);
      this.retryFunctions.scheduleTransientRetry(row, errorCode, source, errorMessage);
      await this.persistence.safeUpdateLog(logId, 'failed', {
        errorCode,
        errorMessage,
        requestTimeoutMs: ghlGuardTimeoutMs(),
        circuitState: source ? this.retryFunctions.circuitState(source) : undefined,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      });
    } finally {
      if (queuedReplayClaimed && !queuedReplayCompleted) {
        try {
          await this.persistence.releaseQueuedReplay(row.id);
        } catch (error) {
          this.logger.error(`GHL queued replay release failed conversation=${row.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  private recordFailure(
    result: GhlGuardRunResult,
    row: GuardConversationRow | null,
    errorCode: string,
    errorMessage?: string,
  ): void {
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

  private updateLog(logId: string | null, status: string, details: Record<string, unknown>): Promise<void> {
    return this.persistence.updateLog(logId, status, details);
  }

}
