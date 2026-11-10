import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { GHL_GUARD_TOKEN_ENV_BY_SOURCE, ghlGuardConversationTimeoutMs, ghlGuardTimeoutMs } from '../../ghl-guard.config';
import { PARTIAL_RECOVERY_INTERVAL_MS, PARTIAL_RECOVERY_MAX_ATTEMPTS } from '../conversations/conversation-webhook.config';
import { completedFieldsBetween } from '../../ghl-guard-audit';
import type { ConversationReconciliationFunctions } from '../conversations/conversation-reconciliation.functions';
import { isConversationIdentityConflict, needsConversationLookup, sourceForLocation } from './ghl-guard.helpers';
import { GhlGuardPersistenceFunctions } from './ghl-guard-persistence.functions';
import { GhlGuardRetryFunctions } from './ghl-guard-retry.functions';
import type { GhlGuardClientPort, GhlGuardFailure, GhlGuardRunResult, GuardConversationRow } from './ghl-guard.types';
import type { SourceConfigMap, SourceKey } from '../conversations/conversation-webhook.types';

export class GhlGuardRowProcessor {
  private readonly logger = new Logger(GhlGuardRowProcessor.name);
  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly reconciliation: ConversationReconciliationFunctions,
    private readonly sourceConfig: SourceConfigMap,
    private readonly client: GhlGuardClientPort,
    private readonly getPersistence: () => GhlGuardPersistenceFunctions,
    private readonly retryFunctions: GhlGuardRetryFunctions,
    private readonly enqueuePendingContactIds: (contactIds: string[]) => void,
  ) {}
  private async markPartialRecoveryCycle(row: GuardConversationRow, now: Date): Promise<void> {
    if (!this.dataSource || row.status !== 'partial') return;
    await this.dataSource.query(
      `UPDATE conversations
       SET partial_recovery_attempts = LEAST(COALESCE(partial_recovery_attempts, 0) + 1, $4::integer),
           partial_recovery_started_at = COALESCE(partial_recovery_started_at, $2::timestamptz),
           partial_recovery_enabled = CASE
             WHEN COALESCE(partial_recovery_attempts, 0) + 1 >= $4::integer THEN false
             ELSE true
           END,
           partial_recovery_next_attempt_at = CASE
             WHEN COALESCE(partial_recovery_attempts, 0) + 1 >= $4::integer THEN NULL
             ELSE $2::timestamptz + ($3::integer * INTERVAL '1 millisecond')
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'partial'`,
      [row.id, now.toISOString(), PARTIAL_RECOVERY_INTERVAL_MS, PARTIAL_RECOVERY_MAX_ATTEMPTS],
    );
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
         AND ($4::text IS NULL
           OR canonical.qualification_snapshot->>'assigned_dealer_id' IS NULL
           OR canonical.qualification_snapshot->>'assigned_dealer_id' = $4::text)
       ORDER BY canonical.last_message_at DESC NULLS LAST, canonical.updated_at DESC
       LIMIT 1`,
      [row.ghl_location_id, row.ghl_contact_id, row.id, row.assigned_dealer_id ?? null],
    ) as Array<{ id: string; ghl_conversation_id: string; status: string }>;
    const canonical = rows[0];
    return canonical?.ghl_conversation_id ? canonical : null;
  }

  private reconcileGuardConversation(id: string, allowSentRepair: boolean, targeted: boolean): Promise<void> {
    if (allowSentRepair) {
      return this.reconciliation.reconcileConversation(id, new Date(), true, true, targeted, false, true);
    }
    return this.reconciliation.reconcileConversation(id, new Date(), true, true, targeted, false);
  }

  async processRow(row: GuardConversationRow, runId: string, now: Date, result: GhlGuardRunResult, targeted = false, queuedOnly = false, allowSentRepair = false): Promise<void> {
    let logId: string | null = null;
    let source: SourceKey | undefined;
    let queuedReplayClaimed = false;
    let queuedReplayCompleted = false;
    const claimedQueuedReplayIds = new Set<string>();
    const completedQueuedReplayIds = new Set<string>();
    const startedAt = new Date();
    const retryDelayMs = row.status === 'partial' ? PARTIAL_RECOVERY_INTERVAL_MS : undefined;
    try {
      logId = await this.getPersistence().createLog(runId, row, 'pending', now);
      if (!logId) {
        this.recordFailure(result, row, 'GHL_GUARD_LOG_CREATE_NOT_PERSISTED');
        return;
      }
      await this.getPersistence().updateLog(logId, 'running', { startedAt });
      await this.markPartialRecoveryCycle(row, now);
      const deadlineAt = Date.now() + ghlGuardConversationTimeoutMs();
      source = sourceForLocation(this.sourceConfig, row.ghl_location_id);
      if (!source) {
        this.recordFailure(result, row, 'SOURCE_NOT_CONFIGURED');
        await this.updateLog(logId, 'failed', { errorCode: 'SOURCE_NOT_CONFIGURED', retryDelayMs, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
        return;
      }
      const token = process.env[GHL_GUARD_TOKEN_ENV_BY_SOURCE[source]]?.trim();
      if (!token) {
        this.recordFailure(result, row, 'GHL_TOKEN_MISSING');
        await this.updateLog(logId, 'failed', { errorCode: 'GHL_TOKEN_MISSING', source, retryDelayMs, finishedAt: new Date(), durationMs: Date.now() });
        return;
      }
      if (await this.retryFunctions.isSourceCircuitOpen(source)) {
        if (row.status !== 'partial') this.enqueuePendingContactIds([row.ghl_contact_id]);
        this.recordFailure(result, row, 'GHL_CIRCUIT_OPEN', 'GHL source circuit is open; retrying the contact later');
        await this.getPersistence().updateLog(logId, 'skipped', {
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
      const allowQueuedReplay = targeted || queuedOnly;
      if (row.status === 'queued') {
        const queuedReplay = await this.getPersistence().claimQueuedReplay(row.id, allowQueuedReplay);
        if (!queuedReplay.allowed) {
          if (queuedOnly) {
            result.queuedReplayFailed = (result.queuedReplayFailed ?? 0) + 1;
            this.recordFailure(result, row, 'GHL_GUARD_QUEUED_REPLAY_BUSY');
          }
          await this.getPersistence().updateLog(logId, 'skipped', {
            source,
            skipReason: 'queued_replay_already_consumed',
            queuedReplay: true,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
          });
          return;
        }
        queuedReplayClaimed = queuedReplay.claimed;
        if (queuedReplayClaimed) claimedQueuedReplayIds.add(row.id);
        if (queuedReplayClaimed) await this.getPersistence().updateLog(logId, 'running', { queuedReplay: true });
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
          await this.getPersistence().updateLog(logId, 'failed', { errorCode: 'GHL_CONVERSATION_LOOKUP_UNAVAILABLE', source, retryDelayMs, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
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
          this.retryFunctions.scheduleTransientRetry(row, errorCode, source, undefined, { suppressImmediateRetry: row.status === 'partial' });
          await this.getPersistence().updateLog(logId, 'failed', {
            errorCode,
            source,
            retryDelayMs,
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
      // A synthetic contact snapshot can share the same contact with a real
      // canonical conversation. If the synthetic row was selected for the
      // queued replay, claim the canonical sibling as well so the successful
      // GHL read cannot leave that sibling permanently eligible at count=0.
      if (queuedReplayClaimed && effectiveRow.id !== row.id) {
        const canonicalReplay = await this.getPersistence().claimQueuedReplay(effectiveRow.id, allowQueuedReplay);
        if (canonicalReplay.claimed) claimedQueuedReplayIds.add(effectiveRow.id);
      }
      const fetched = await this.client.listMessages(token, conversationId, { deadlineAt });
      if (!fetched.ok || !fetched.data) {
        const errorCode = fetched.errorCode || 'GHL_MESSAGES_READ_FAILED';
        this.recordFailure(result, row, errorCode);
        this.retryFunctions.scheduleTransientRetry(row, errorCode, source, undefined, { suppressImmediateRetry: row.status === 'partial' });
        await this.getPersistence().updateLog(logId, 'failed', {
          errorCode,
          source,
          retryDelayMs,
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
      const persisted = await this.getPersistence().persistMessages(effectiveRow, fetched.data.messages, allowQueuedReplay);
      if (persisted.skipped) {
        // The queued row can be a synthetic local snapshot whose canonical
        // sibling is already protected (for example, sent). The backup still
        // executed the GHL read successfully. Reconcile it before consuming
        // the replay: a successful read can contain no new messages while
        // still carrying native profile/name evidence that repairs a stale
        // qualification snapshot.
        if (queuedReplayClaimed) {
          await this.reconcileGuardConversation(effectiveRow.id, allowSentRepair, true);
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
            await this.reconcileGuardConversation(syntheticConversationId, allowSentRepair, true);
          }
          for (const replayId of claimedQueuedReplayIds) {
            const completed = await this.getPersistence().completeQueuedReplay(replayId);
            if (!completed) throw new Error('GHL_GUARD_QUEUED_REPLAY_COMPLETION_NOT_PERSISTED');
            completedQueuedReplayIds.add(replayId);
          }
          queuedReplayCompleted = true;
          if (queuedOnly) result.queuedReplayCompleted = (result.queuedReplayCompleted ?? 0) + 1;
          await this.getPersistence().updateLog(logId, 'succeeded', {
            source,
            queuedReplay: true,
            persistenceSkipped: true,
            fetchedMessages: fetched.data.messages.length,
            responsePayload: fetched.data.responsePayload,
            httpStatus: fetched.status,
            requestPath: fetched.requestPath,
            pages: fetched.data.pages,
            truncated: fetched.data.truncated,
            reconciled: true,
            manualSentRepair: allowSentRepair,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            ...lookupMetadata,
          });
          return;
        }
        await this.getPersistence().updateLog(logId, 'skipped', {
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
        ? await this.getPersistence().mergeSyntheticConversationMessages(syntheticConversationId, effectiveRow.id)
        : 0;
      const leadMetadataBefore = await this.getPersistence().readLeadMetadata(effectiveRow.id);
      if (targeted || queuedOnly) {
        await this.reconcileGuardConversation(effectiveRow.id, allowSentRepair, true);
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
        await this.reconcileGuardConversation(syntheticConversationId, allowSentRepair, true);
      }
      const leadMetadataAfter = await this.getPersistence().readLeadMetadata(effectiveRow.id);
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
        for (const replayId of claimedQueuedReplayIds) {
          const completed = await this.getPersistence().completeQueuedReplay(replayId);
          if (!completed) {
            throw new Error('GHL_GUARD_QUEUED_REPLAY_COMPLETION_NOT_PERSISTED');
          }
          completedQueuedReplayIds.add(replayId);
        }
        queuedReplayCompleted = true;
        if (queuedOnly) result.queuedReplayCompleted = (result.queuedReplayCompleted ?? 0) + 1;
      }
      await this.getPersistence().updateLog(logId, 'succeeded', {
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
        manualSentRepair: allowSentRepair,
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
      if (queuedOnly && queuedReplayClaimed && !queuedReplayCompleted) {
        result.queuedReplayFailed = (result.queuedReplayFailed ?? 0) + 1;
      }
      this.retryFunctions.scheduleTransientRetry(row, errorCode, source, errorMessage, { suppressImmediateRetry: row.status === 'partial' });
      await this.getPersistence().safeUpdateLog(logId, 'failed', {
        errorCode,
        errorMessage,
        retryDelayMs,
        requestTimeoutMs: ghlGuardTimeoutMs(),
        circuitState: source ? this.retryFunctions.circuitState(source) : undefined,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      });
    } finally {
      if (queuedReplayClaimed && !queuedReplayCompleted) {
        for (const replayId of claimedQueuedReplayIds) {
          if (completedQueuedReplayIds.has(replayId)) continue;
          try {
            await this.getPersistence().releaseQueuedReplay(replayId);
          } catch (error) {
            this.logger.error(`GHL queued replay release failed conversation=${replayId}: ${error instanceof Error ? error.message : String(error)}`);
          }
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
    return this.getPersistence().updateLog(logId, status, details);
  }

}
