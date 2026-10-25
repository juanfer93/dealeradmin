import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { normalizeGhlAttachments } from '../../../domain/ghl-attachment-normalizer';
import type { GhlGuardMessage } from '../../ghl-guard.client';
import {
  ghlGuardRetryDelayMs,
  ghlGuardStaleLogMs,
} from '../../ghl-guard.config';
import { type GhlGuardLeadMetadata } from '../../ghl-guard-audit';
import { parseOccurredAt } from '../conversations/conversation-webhook.helpers';
import {
  latestInboundAt,
  messageBody,
  messageId,
  normalizeDirection,
} from './ghl-guard.helpers';
import type {
  GhlGuardSkipReason,
  GuardAuditRow,
  GuardConversationRow,
  LeadMetadataRow,
  PersistResult,
} from './ghl-guard.types';
import { configureWebhookTransactionSafety } from '../../transaction-safety';

export class GhlGuardPersistenceFunctions {
  private readonly logger = new Logger(GhlGuardPersistenceFunctions.name);

  constructor(private readonly dataSource: DataSource | undefined) {}

  async claimQueuedReplay(conversationId: string, allowTargetedReplay = false): Promise<{ allowed: boolean; claimed: boolean }> {
    if (!this.dataSource) return { allowed: false, claimed: false };
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await configureWebhookTransactionSafety(runner);
      const rows = await runner.query(
        `SELECT status, queued_guard_replay_count, queued_guard_replay_claimed_at
         FROM conversations
         WHERE id = $1
         FOR UPDATE`,
        [conversationId],
      ) as Array<{ status: string; queued_guard_replay_count: number | string | null; queued_guard_replay_claimed_at: string | null }>;
      const row = rows[0];
      if (!row) {
        await runner.rollbackTransaction();
        return { allowed: false, claimed: false };
      }
      if (row.status !== 'queued') {
        await runner.commitTransaction();
        return { allowed: true, claimed: false };
      }
      if (Number(row.queued_guard_replay_count ?? 0) > 0) {
        await runner.commitTransaction();
        return { allowed: allowTargetedReplay, claimed: false };
      }
      if (row.queued_guard_replay_claimed_at
        && new Date(row.queued_guard_replay_claimed_at).getTime() > Date.now() - ghlGuardStaleLogMs()) {
        await runner.commitTransaction();
        return { allowed: false, claimed: false };
      }
      const claimedRows = await runner.query(
        `UPDATE conversations
         SET queued_guard_replay_claimed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'queued' AND queued_guard_replay_count = 0
           AND (queued_guard_replay_claimed_at IS NULL
             OR queued_guard_replay_claimed_at <= CURRENT_TIMESTAMP - ($2::integer * INTERVAL '1 millisecond'))
         RETURNING id`,
        [conversationId, ghlGuardStaleLogMs()],
      ) as Array<{ id: string }>;
      await runner.commitTransaction();
      return { allowed: claimedRows.length > 0, claimed: claimedRows.length > 0 };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async completeQueuedReplay(conversationId: string): Promise<boolean> {
    if (!this.dataSource) return false;
    const rows = await this.dataSource.query(
      `UPDATE conversations
       SET queued_guard_replay_count = queued_guard_replay_count + 1,
           queued_guard_replay_claimed_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'queued'
         AND queued_guard_replay_count = 0
         AND queued_guard_replay_claimed_at IS NOT NULL
       RETURNING id`,
      [conversationId],
    ) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async releaseQueuedReplay(conversationId: string): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(
      `UPDATE conversations
       SET queued_guard_replay_claimed_at = NULL
       WHERE id = $1 AND status = 'queued'
         AND queued_guard_replay_count = 0`,
      [conversationId],
    );
  }

  async persistMessages(row: GuardConversationRow, messages: GhlGuardMessage[], allowTargetedStatuses = false): Promise<PersistResult> {
    const runner = this.dataSource!.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await configureWebhookTransactionSafety(runner);
      const protectedRows = await runner.query(
        `SELECT id, status FROM conversations
         WHERE id = $1 AND status NOT IN (${allowTargetedStatuses ? "'sent', 'ignored_channel', 'stale_phone_ignored'" : "'queued', 'sent', 'duplicate_ignored', 'ignored_channel', 'stale_phone_ignored'"})
         FOR UPDATE`,
        [row.id],
      ) as Array<{ id: string; status: string }>;
      if (!protectedRows[0]) {
        await runner.rollbackTransaction();
        return { skipped: true, inserted: 0, repaired: 0 };
      }

      let inserted = 0;
      let repaired = 0;
      for (const message of messages) {
        const id = messageId(message);
        if (!id) continue;
        const direction = normalizeDirection(message.direction);
        const body = messageBody(message);
        const occurredAt = parseOccurredAt(typeof message.dateAdded === 'string' ? message.dateAdded : undefined);
        const rawPayload = JSON.stringify({ ...message, dealeradmin_guard: { fetched_at: new Date().toISOString() } });
        const insertedRows = await runner.query(
          `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, direction, body, occurred_at, raw_payload)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)
           ON CONFLICT (conversation_id, dedupe_key) DO NOTHING
           RETURNING id`,
          [row.id, id, typeof message.id === 'string' ? message.id : typeof message.altId === 'string' ? message.altId : null, direction, body, occurredAt, rawPayload],
        ) as Array<{ id: string }>;
        if (insertedRows[0]) inserted += 1;
        const repairedRows = await runner.query(
          `UPDATE conversation_messages
           SET body = CASE WHEN btrim(body) = '' THEN $3 ELSE body END,
               direction = CASE WHEN direction = 'unknown' THEN $4 ELSE direction END,
               occurred_at = COALESCE(occurred_at, $5::timestamptz),
               raw_payload = CASE WHEN raw_payload = '{}'::jsonb THEN $6::jsonb ELSE raw_payload END
           WHERE conversation_id = $1 AND dedupe_key = $2
             AND (btrim(body) = '' OR direction = 'unknown' OR raw_payload = '{}'::jsonb)
           RETURNING id`,
          [row.id, id, body, direction, occurredAt, rawPayload],
        ) as Array<{ id: string }>;
        if (repairedRows[0]) repaired += 1;

        const attachments = normalizeGhlAttachments(message.attachments, typeof message.id === 'string' ? message.id : id);
        for (const attachment of attachments) {
          await runner.query(
            `INSERT INTO conversation_attachments
              (conversation_id, conversation_message_id, ghl_location_id, ghl_conversation_id, ghl_message_id,
               source_url, source_url_expires_at, content_type, media_kind, original_filename, byte_size,
               processing_status, processing_metadata)
             SELECT $1, cm.id, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, 'pending', $12::jsonb
             FROM conversation_messages cm
             WHERE cm.conversation_id = $1 AND cm.dedupe_key = $2
             ON CONFLICT (conversation_message_id, source_url) DO UPDATE SET
               content_type = COALESCE(EXCLUDED.content_type, conversation_attachments.content_type),
               media_kind = CASE WHEN conversation_attachments.media_kind = 'unknown' THEN EXCLUDED.media_kind ELSE conversation_attachments.media_kind END,
               original_filename = COALESCE(EXCLUDED.original_filename, conversation_attachments.original_filename),
               byte_size = COALESCE(EXCLUDED.byte_size, conversation_attachments.byte_size),
               source_url_expires_at = COALESCE(EXCLUDED.source_url_expires_at, conversation_attachments.source_url_expires_at),
               updated_at = CURRENT_TIMESTAMP`,
            [row.id, id, row.ghl_location_id, row.ghl_conversation_id, typeof message.id === 'string' ? message.id : id,
              attachment.sourceUrl, attachment.expiresAt, attachment.contentType, attachment.kind, attachment.filename,
              attachment.size, JSON.stringify({ source_id: attachment.sourceId, raw: attachment.raw, source: 'ghl_guard' })],
          );
        }
      }
      const latestInbound = latestInboundAt(messages);
      if (latestInbound) {
        await runner.query(
          `UPDATE conversations
           SET last_message_at = GREATEST(COALESCE(last_message_at, $2::timestamptz), $2::timestamptz), updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [row.id, latestInbound],
        );
      }
      await runner.commitTransaction();
      return { skipped: false, inserted, repaired };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async readLeadMetadata(conversationId: string): Promise<GhlGuardLeadMetadata | null> {
    if (!this.dataSource) return null;
    try {
      const rows = await this.dataSource.query(
        `SELECT l.id::text AS lead_id, l.ghl_contact_id, l.ghl_location_id,
                l.first_name, l.last_name, l.canonical_phone, l.email, l.source,
                c.qualification_snapshot, c.location_snapshot,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'dealer_id', ld.dealer_id::text,
                  'vehicle_type', ld.vehicle_type,
                  'down_payment', ld.down_payment,
                  'purchase_timeline', ld.purchase_timeline,
                  'documents', ld.documents,
                  'easterns_zone', ld.easterns_zone,
                  'routing_status', ld.routing_status,
                  'assigned_dealer_id', ld.assigned_dealer_id::text,
                  'routing_override', ld.routing_override,
                  'routing_reason', ld.routing_reason,
                  'status', ld.status,
                  'message_text', ld.message_text
                ) ORDER BY ld.dealer_id) FILTER (WHERE ld.lead_id IS NOT NULL), '[]'::jsonb) AS dealer_relations
         FROM conversations c
         JOIN leads l ON l.id = c.lead_id
         LEFT JOIN lead_dealers ld ON ld.lead_id = l.id
         WHERE c.id = $1
         GROUP BY l.id, l.ghl_contact_id, l.ghl_location_id, l.first_name, l.last_name,
                  l.canonical_phone, l.email, l.source, c.qualification_snapshot, c.location_snapshot`,
        [conversationId],
      ) as LeadMetadataRow[];
      const row = rows[0];
      if (!row) return null;
      return {
        lead: {
          id: row.lead_id,
          ghl_contact_id: row.ghl_contact_id,
          ghl_location_id: row.ghl_location_id,
          first_name: row.first_name,
          last_name: row.last_name,
          canonical_phone: row.canonical_phone,
          email: row.email,
          source: row.source,
        },
        qualification: row.qualification_snapshot,
        location: row.location_snapshot,
        dealer_relations: row.dealer_relations ?? [],
      };
    } catch (error) {
      this.logAuditError('GHL_GUARD_LEAD_METADATA_READ_FAILED', error, { conversationId });
      return null;
    }
  }

  async mergeSyntheticConversationMessages(sourceConversationId: string, targetConversationId: string): Promise<number> {
    if (!this.dataSource || sourceConversationId === targetConversationId) return 0;
    const rows = await this.dataSource.query(
      `WITH moved AS (
         UPDATE conversation_messages source
         SET conversation_id = $2
         WHERE source.conversation_id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM conversation_messages target
             WHERE target.conversation_id = $2
               AND target.dedupe_key = source.dedupe_key
           )
         RETURNING occurred_at
       ), updated AS (
         UPDATE conversations target
         SET last_message_at = GREATEST(
               target.last_message_at,
               COALESCE((SELECT MAX(occurred_at) FROM moved), target.last_message_at)
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE target.id = $2
         RETURNING target.id
       )
       SELECT (SELECT COUNT(*)::int FROM moved) AS moved_count,
              (SELECT COUNT(*) FROM updated) AS updated_count`,
      [sourceConversationId, targetConversationId],
    ) as Array<{ moved_count: number | string }>;
    return Number(rows[0]?.moved_count) || 0;
  }

  async recoverStaleLogs(now: Date): Promise<void> {
    try {
      await this.dataSource?.query(
        `UPDATE ghl_guard_logs
         SET status = 'failed',
             finished_at = $1::timestamptz,
             duration_ms = GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - COALESCE(started_at, scheduled_at))) * 1000)::integer,
             error_code = COALESCE(error_code, 'GHL_GUARD_STALE_RUN'),
             next_retry_at = $1::timestamptz + ($2::integer * INTERVAL '1 millisecond'),
             lease_expires_at = NULL,
             metadata = jsonb_set(
               metadata || jsonb_build_object('recoveredAt', $1::text, 'recoveryReason', 'stale_guard_log'),
               '{lifecycle}',
               COALESCE(metadata->'lifecycle', '[]'::jsonb) || jsonb_build_array('stale_recovered')
             )
         WHERE status IN ('pending', 'running')
           AND (
             (lease_expires_at IS NOT NULL AND lease_expires_at < $1::timestamptz)
             OR COALESCE(started_at, scheduled_at) < $1::timestamptz - ($3::integer * INTERVAL '1 millisecond')
           )`,
        [now.toISOString(), ghlGuardRetryDelayMs(), ghlGuardStaleLogMs()],
      );
    } catch (error) {
      this.logAuditError('GHL_GUARD_STALE_RECOVERY_FAILED', error);
      // Stale-log recovery is audit hygiene and must not block message repair.
    }
  }

  async logSkip(runId: string, reason: GhlGuardSkipReason, contactIds: string[], enabled: boolean): Promise<void> {
    if (!enabled || !this.dataSource) return;
    try {
      await this.dataSource.query(
        `INSERT INTO ghl_guard_logs
          (run_id, status, skip_reason, metadata)
         VALUES ($1, 'skipped', $2, $3::jsonb)`,
        [runId, reason, JSON.stringify({ lifecycle: ['skipped'], targetContactIds: contactIds })],
      );
    } catch (error) {
      this.logger.error(`GHL guard skip log persistence failed reason=${reason}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async log(runId: string, row: GuardConversationRow | null, status: string, metadata: Record<string, unknown> = {}): Promise<void> {
    if (!this.dataSource) return;
    try {
      await this.dataSource.query(
        `INSERT INTO ghl_guard_logs
          (run_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, conversation_id,
           status, fetched_message_count, inserted_message_count, repaired_message_count,
           reconciled, duration_ms, error_code, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
        [runId, row?.ghl_location_id ?? null, row?.ghl_contact_id ?? null, row?.ghl_conversation_id ?? null, row?.id ?? null,
          status, Number(metadata.fetchedMessages ?? 0), Number(metadata.insertedMessages ?? 0), Number(metadata.repairedMessages ?? 0),
          metadata.reconciled === true, metadata.durationMs ?? null, metadata.errorCode ?? null, JSON.stringify(metadata)],
      );
    } catch (error) {
      this.logAuditError('GHL_GUARD_RUN_LOG_FAILED', error, { runId, status });
      // Guard telemetry must never block webhook processing or due release.
    }
  }

  async createLog(runId: string, row: GuardConversationRow, status: string, scheduledAt: Date): Promise<string | null> {
    if (!this.dataSource) return null;
    try {
      const rows = await this.dataSource.query(
        `WITH previous_attempt AS (
           SELECT COALESCE(MAX(attempt_count), 0) + 1 AS attempt_count
           FROM ghl_guard_logs WHERE conversation_id = $5
         )
         INSERT INTO ghl_guard_logs
          (run_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, conversation_id, status, scheduled_at, lease_expires_at, metadata)
         SELECT $1, $2, $3, $4, $5, $6, $7::timestamptz,
                CURRENT_TIMESTAMP + ($8::integer * INTERVAL '1 millisecond'),
                jsonb_build_object('lifecycle', jsonb_build_array('pending'), 'attemptCount', previous_attempt.attempt_count)
         FROM previous_attempt
         RETURNING id`,
        [runId, row.ghl_location_id, row.ghl_contact_id, row.ghl_conversation_id, row.id, status,
          scheduledAt.toISOString(), ghlGuardStaleLogMs()],
      ) as Array<{ id: string }>;
      if (!rows[0]?.id) {
        const error = new Error('INSERT returned no guard log id');
        error.name = 'GHL_GUARD_LOG_CREATE_NOT_PERSISTED';
        this.logAuditError(error.name, error, { runId, conversationId: row.id });
        throw error;
      }
      return rows[0].id;
    } catch (error) {
      const persistenceError = new Error(error instanceof Error ? error.message : String(error));
      persistenceError.name = error instanceof Error && error.name !== 'Error' ? error.name : 'GHL_GUARD_LOG_CREATE_FAILED';
      this.logAuditError(persistenceError.name, error, { runId, conversationId: row.id });
      throw persistenceError;
    }
  }

  async updateLog(logId: string | null, status: string, details: Record<string, unknown>): Promise<void> {
    if (!this.dataSource || !logId) return;
    const metadata = { ...details };
    delete metadata.startedAt;
    delete metadata.finishedAt;
    delete metadata.responsePayload;
    delete metadata.leadMetadata;
    delete metadata.completedFields;
    const explicitDuration = typeof details.durationMs === 'number' && Number.isFinite(details.durationMs)
      ? details.durationMs
      : null;
    const derivedDuration = details.startedAt instanceof Date && details.finishedAt instanceof Date
      ? details.finishedAt.getTime() - details.startedAt.getTime()
      : null;
    const rows = await this.dataSource.query(
      `UPDATE ghl_guard_logs
       SET status = $2::varchar,
           started_at = COALESCE($3::timestamptz, started_at),
           finished_at = COALESCE($4::timestamptz, finished_at),
           duration_ms = COALESCE($5, duration_ms),
           fetched_message_count = COALESCE($6, fetched_message_count),
           inserted_message_count = COALESCE($7, inserted_message_count),
           repaired_message_count = COALESCE($8, repaired_message_count),
           reconciled = COALESCE($9, reconciled),
           http_status = COALESCE($10, http_status),
           request_path = COALESCE($11, request_path),
           error_code = COALESCE($12, error_code),
           response_payload = COALESCE($13::jsonb, response_payload),
           lead_metadata = COALESCE($18::jsonb, lead_metadata),
           completed_fields = COALESCE($19::jsonb, completed_fields),
           request_attempt_count = COALESCE($20, request_attempt_count),
           request_elapsed_ms = COALESCE($21, request_elapsed_ms),
           request_timeout_ms = COALESCE($22, request_timeout_ms),
           circuit_state = COALESCE($23::varchar, circuit_state),
           next_retry_at = CASE WHEN $2::varchar = 'failed' THEN CURRENT_TIMESTAMP + ($16::integer * INTERVAL '1 millisecond') ELSE next_retry_at END,
           lease_expires_at = CASE WHEN $2::varchar IN ('pending', 'running') THEN CURRENT_TIMESTAMP + ($17::integer * INTERVAL '1 millisecond') ELSE NULL END,
           metadata = jsonb_set(metadata || $14::jsonb, '{lifecycle}',
             COALESCE(metadata->'lifecycle', '[]'::jsonb) || jsonb_build_array($15::text))
       WHERE id = $1::uuid
         AND (status IN ('pending', 'running') OR status = $2::varchar)
       RETURNING id::text AS id, status`,
      [logId, status,
        details.startedAt instanceof Date ? details.startedAt.toISOString() : null,
        details.finishedAt instanceof Date ? details.finishedAt.toISOString() : null,
        explicitDuration ?? derivedDuration,
        details.fetchedMessages ?? null, details.insertedMessages ?? null, details.repairedMessages ?? null,
        details.reconciled === true ? true : null, details.httpStatus ?? null, details.requestPath ?? null,
        details.errorCode ?? null, details.responsePayload === undefined ? null : JSON.stringify(details.responsePayload), JSON.stringify(metadata), status,
        ghlGuardRetryDelayMs(), ghlGuardStaleLogMs(),
        details.leadMetadata === undefined || details.leadMetadata === null ? null : JSON.stringify(details.leadMetadata),
        details.completedFields === undefined || details.completedFields === null ? null : JSON.stringify(details.completedFields),
        details.requestAttempts ?? null,
        details.requestElapsedMs ?? null,
        details.requestTimeoutMs ?? null,
        details.circuitState ?? null],
    ) as GuardAuditRow[];
    if (rows[0]?.id) return;

    const currentRows = await this.dataSource.query(
      `SELECT id::text AS id, status
       FROM ghl_guard_logs
       WHERE id = $1::uuid`,
      [logId],
    ) as GuardAuditRow[];
    if (currentRows[0]?.status === status) return;

    throw new Error(`GHL_GUARD_LOG_UPDATE_NOT_PERSISTED:${status}:${currentRows[0]?.status ?? 'missing'}`);
  }

  async safeUpdateLog(logId: string | null, status: string, details: Record<string, unknown>): Promise<void> {
    try {
      await this.updateLog(logId, status, details);
    } catch (error) {
      this.logAuditError('GHL_GUARD_LOG_UPDATE_FAILED', error, { logId, status });
    }
  }

  logAuditError(code: string, error: unknown, context: Record<string, unknown> = {}): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`${code}: ${message}`, JSON.stringify(context));
  }
}
