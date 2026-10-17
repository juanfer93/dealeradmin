import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { normalizeGhlAttachments } from '../domain/ghl-attachment-normalizer';
import { hash, parseOccurredAt } from './functions/conversation-webhook.helpers';
import { GHL_SOURCE_CONFIG, RECONCILIATION_LOCATION_IDS } from './functions/conversation-webhook.config';
import type { SourceConfigMap, SourceKey } from './functions/conversation-webhook.types';
import { ConversationReconciliationFunctions } from './functions/conversation-reconciliation.functions';
import {
  ghlGuardBatchSize,
  ghlGuardConcurrency,
  ghlGuardConversationTimeoutMs,
  GHL_GUARD_LOCK_KEY,
  ghlGuardEnabled,
  ghlGuardIntervalMs,
  ghlGuardRetryDelayMs,
  ghlGuardStaleLogMs,
  GHL_GUARD_TOKEN_ENV_BY_SOURCE,
} from './ghl-guard.config';
import { GhlGuardClient, type GhlGuardMessage } from './ghl-guard.client';
import { completedFieldsBetween, type GhlGuardLeadMetadata } from './ghl-guard-audit';

type GuardConversationRow = {
  id: string;
  ghl_location_id: string;
  ghl_contact_id: string;
  ghl_conversation_id: string | null;
  status: string;
};

type PersistResult = {
  skipped: boolean;
  inserted: number;
  repaired: number;
};

type LeadMetadataRow = {
  lead_id: string;
  ghl_contact_id: string;
  ghl_location_id: string;
  first_name: string | null;
  last_name: string | null;
  canonical_phone: string | null;
  email: string | null;
  source: string | null;
  qualification_snapshot: Record<string, unknown> | null;
  location_snapshot: Record<string, unknown> | null;
  dealer_relations: Array<Record<string, unknown>> | null;
};

type GuardAuditRow = {
  id: string;
  status: string;
};

export type GhlGuardRunResult = {
  enabled: boolean;
  skipped: boolean;
  selected: number;
  fetched: number;
  inserted: number;
  repaired: number;
  failed: number;
  errors?: GhlGuardFailure[];
};

export type GhlGuardFailure = {
  conversationId: string | null;
  ghlLocationId: string | null;
  ghlContactId: string | null;
  errorCode: string;
  errorMessage?: string;
};

type GhlGuardClientPort = Pick<GhlGuardClient, 'listMessages'> & Partial<Pick<GhlGuardClient, 'searchConversationByContact'>>;

function needsConversationLookup(conversationId: string | null): boolean {
  return !conversationId?.trim() || conversationId.trim().startsWith('contact:');
}

function sourceForLocation(sourceConfig: SourceConfigMap, locationId: string): SourceKey | undefined {
  return Object.entries(sourceConfig).find(([, config]) => config.locationId === locationId)?.[0] as SourceKey | undefined;
}

function normalizeDirection(value: unknown): 'inbound' | 'outbound' | 'unknown' {
  const direction = String(value ?? '').trim().toLowerCase();
  if (direction === 'inbound') return 'inbound';
  if (direction === 'outbound') return 'outbound';
  return 'unknown';
}

function messageBody(message: GhlGuardMessage): string {
  if (typeof message.body === 'string') return message.body.replace(/\r\n?/g, '\n').trim();
  if (message.body === undefined || message.body === null) return '';
  return JSON.stringify(message.body);
}

function messageId(message: GhlGuardMessage): string | null {
  const value = message.id ?? message.altId;
  if (typeof value === 'string' && value.trim()) return value.trim();
  const fallback = hash(JSON.stringify({ body: message.body, direction: message.direction, dateAdded: message.dateAdded, source: message.source }));
  return `guard:${fallback}`;
}

function latestInboundAt(messages: GhlGuardMessage[]): string | null {
  const timestamps = messages
    .filter((message) => normalizeDirection(message.direction) === 'inbound')
    .map((message) => parseOccurredAt(typeof message.dateAdded === 'string' ? message.dateAdded : undefined));
  if (timestamps.length === 0) return null;
  return timestamps.sort().at(-1) ?? null;
}

@Injectable()
export class GhlGuardService {
  private readonly logger = new Logger(GhlGuardService.name);
  private running = false;
  private lastRunAt = 0;

  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly reconciliation: ConversationReconciliationFunctions,
    private readonly sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
    private readonly client: GhlGuardClientPort = new GhlGuardClient(),
  ) {}

  async run(now = new Date()): Promise<GhlGuardRunResult> {
    const empty: GhlGuardRunResult = { enabled: ghlGuardEnabled(), skipped: true, selected: 0, fetched: 0, inserted: 0, repaired: 0, failed: 0 };
    if (!empty.enabled || !this.dataSource) return empty;
    if (this.running || now.getTime() - this.lastRunAt < ghlGuardIntervalMs()) return empty;
    this.running = true;
    this.lastRunAt = now.getTime();

    const result: GhlGuardRunResult = { ...empty, skipped: false };
    const lockRunner = this.dataSource.createQueryRunner();
    const runId = randomUUID();
    await lockRunner.connect();
    try {
      const locked = await lockRunner.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [GHL_GUARD_LOCK_KEY]) as Array<{ locked: boolean }>;
      if (!locked[0]?.locked) return { ...result, skipped: true };
      await this.recoverStaleLogs(now);
      const rows = await lockRunner.query(
        `SELECT id, ghl_location_id, ghl_contact_id, ghl_conversation_id, status
         FROM conversations
         LEFT JOIN LATERAL (
           SELECT latest_guard.created_at
           FROM ghl_guard_logs latest_guard
           WHERE latest_guard.conversation_id = conversations.id
           ORDER BY latest_guard.created_at DESC
           LIMIT 1
         ) last_guard ON TRUE
         WHERE status NOT IN ('queued', 'sent', 'duplicate_ignored', 'ignored_channel', 'stale_phone_ignored')
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
         ORDER BY last_guard.created_at NULLS FIRST,
                  last_message_at DESC NULLS LAST,
                  updated_at DESC
         LIMIT $1`,
        [ghlGuardBatchSize(), RECONCILIATION_LOCATION_IDS],
      ) as GuardConversationRow[];
      result.selected = rows.length;
      const concurrency = Math.min(ghlGuardConcurrency(), rows.length);
      for (let offset = 0; offset < rows.length; offset += concurrency) {
        const batch = rows.slice(offset, offset + concurrency);
        await Promise.all(batch.map((row) => this.processRow(row, runId, now, result)));
      }
      return result;
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : 'GHL_GUARD_RUN_FAILED';
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.log(runId, null, 'failed', { errorCode, errorMessage });
      this.recordFailure(result, null, errorCode, errorMessage);
      return result;
    } finally {
      try { await lockRunner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [GHL_GUARD_LOCK_KEY]); } catch { /* best effort */ }
      await lockRunner.release();
      this.running = false;
    }
  }

  private async processRow(row: GuardConversationRow, runId: string, now: Date, result: GhlGuardRunResult): Promise<void> {
    let logId: string | null = null;
    const startedAt = new Date();
    try {
      logId = await this.createLog(runId, row, 'pending', now);
      if (!logId) {
        this.recordFailure(result, row, 'GHL_GUARD_LOG_CREATE_NOT_PERSISTED');
        return;
      }
      await this.updateLog(logId, 'running', { startedAt });
      const deadlineAt = Date.now() + ghlGuardConversationTimeoutMs();
      const source = sourceForLocation(this.sourceConfig, row.ghl_location_id);
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
      let effectiveRow = row;
      let conversationId = row.ghl_conversation_id?.trim() ?? '';
      let lookupMetadata: Record<string, unknown> = {};
      if (needsConversationLookup(row.ghl_conversation_id)) {
        if (!this.client.searchConversationByContact) {
          this.recordFailure(result, row, 'GHL_CONVERSATION_LOOKUP_UNAVAILABLE');
          await this.updateLog(logId, 'failed', { errorCode: 'GHL_CONVERSATION_LOOKUP_UNAVAILABLE', source, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
          return;
        }
        const lookup = await this.client.searchConversationByContact(token, row.ghl_location_id, row.ghl_contact_id, { deadlineAt });
        lookupMetadata = { conversationLookup: { requestPath: lookup.requestPath, httpStatus: lookup.status, resolved: Boolean(lookup.data?.conversation?.id) } };
        if (!lookup.ok || !lookup.data?.conversation?.id) {
          const errorCode = lookup.errorCode || 'GHL_CONVERSATION_NOT_FOUND';
          this.recordFailure(result, row, errorCode);
          await this.updateLog(logId, 'failed', {
            errorCode,
            source,
            httpStatus: lookup.status,
            requestPath: lookup.requestPath,
            responsePayload: lookup.responsePayload,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            ...lookupMetadata,
          });
          return;
        }
        conversationId = lookup.data.conversation.id;
        await this.dataSource!.query(
          `UPDATE conversations
           SET ghl_conversation_id = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND (ghl_conversation_id IS NULL OR ghl_conversation_id LIKE 'contact:%')`,
          [row.id, conversationId],
        );
        effectiveRow = { ...row, ghl_conversation_id: conversationId };
      }
      const fetched = await this.client.listMessages(token, conversationId, { deadlineAt });
      if (!fetched.ok || !fetched.data) {
        const errorCode = fetched.errorCode || 'GHL_MESSAGES_READ_FAILED';
        this.recordFailure(result, row, errorCode);
        await this.updateLog(logId, 'failed', {
          errorCode,
          source,
          httpStatus: fetched.status,
          requestPath: fetched.requestPath,
          responsePayload: fetched.responsePayload,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          ...lookupMetadata,
        });
        return;
      }
      result.fetched += fetched.data.messages.length;
      const persisted = await this.persistMessages(effectiveRow, fetched.data.messages);
      if (persisted.skipped) {
        await this.updateLog(logId, 'skipped', {
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
      const leadMetadataBefore = await this.readLeadMetadata(effectiveRow.id);
      await this.reconciliation.reconcileConversation(effectiveRow.id, new Date(), true, true);
      const leadMetadataAfter = await this.readLeadMetadata(effectiveRow.id);
      const completedFields = completedFieldsBetween(leadMetadataBefore, leadMetadataAfter);
      await this.updateLog(logId, 'succeeded', {
        source,
        fetchedMessages: fetched.data.messages.length,
        insertedMessages: persisted.inserted,
        repairedMessages: persisted.repaired,
        responsePayload: fetched.data.responsePayload,
        httpStatus: fetched.status,
        requestPath: fetched.requestPath,
        pages: fetched.data.pages,
        truncated: fetched.data.truncated,
        reconciled: true,
        leadMetadata: leadMetadataAfter,
        completedFields,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        ...lookupMetadata,
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : 'GHL_GUARD_CONVERSATION_FAILED';
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.recordFailure(result, row, errorCode, errorMessage);
      await this.safeUpdateLog(logId, 'failed', {
        errorCode,
        errorMessage,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      });
    }
  }

  private async persistMessages(row: GuardConversationRow, messages: GhlGuardMessage[]): Promise<PersistResult> {
    const runner = this.dataSource!.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const protectedRows = await runner.query(
        `SELECT id, status FROM conversations
         WHERE id = $1 AND status NOT IN ('queued', 'sent', 'duplicate_ignored', 'ignored_channel', 'stale_phone_ignored')
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

  private async readLeadMetadata(conversationId: string): Promise<GhlGuardLeadMetadata | null> {
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

  private async recoverStaleLogs(now: Date): Promise<void> {
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
             OR (lease_expires_at IS NULL AND COALESCE(started_at, scheduled_at) < $1::timestamptz - ($3::integer * INTERVAL '1 millisecond'))
           )`,
        [now.toISOString(), ghlGuardRetryDelayMs(), ghlGuardStaleLogMs()],
      );
    } catch (error) {
      this.logAuditError('GHL_GUARD_STALE_RECOVERY_FAILED', error);
      // Stale-log recovery is audit hygiene and must not block message repair.
    }
  }

  private async log(
    runId: string,
    row: GuardConversationRow | null,
    status: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
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

  private async createLog(runId: string, row: GuardConversationRow, status: string, scheduledAt: Date): Promise<string | null> {
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

  private async updateLog(logId: string | null, status: string, details: Record<string, unknown>): Promise<void> {
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
           next_retry_at = CASE WHEN $2::varchar = 'failed' THEN CURRENT_TIMESTAMP + ($16::integer * INTERVAL '1 millisecond') ELSE next_retry_at END,
           lease_expires_at = CASE WHEN $2::varchar IN ('pending', 'running') THEN CURRENT_TIMESTAMP + ($17::integer * INTERVAL '1 millisecond') ELSE NULL END,
           metadata = jsonb_set(metadata || $14::jsonb, '{lifecycle}',
             COALESCE(metadata->'lifecycle', '[]'::jsonb) || jsonb_build_array($15::text))
       WHERE id = $1::uuid
         AND (status IN ('pending', 'running') OR status = $2::varchar)
       RETURNING id, status`,
      [logId, status,
        details.startedAt instanceof Date ? details.startedAt.toISOString() : null,
        details.finishedAt instanceof Date ? details.finishedAt.toISOString() : null,
        explicitDuration ?? derivedDuration,
        details.fetchedMessages ?? null, details.insertedMessages ?? null, details.repairedMessages ?? null,
        details.reconciled === true ? true : null, details.httpStatus ?? null, details.requestPath ?? null,
        details.errorCode ?? null, details.responsePayload === undefined ? null : JSON.stringify(details.responsePayload), JSON.stringify(metadata), status,
        ghlGuardRetryDelayMs(), ghlGuardStaleLogMs(),
        details.leadMetadata === undefined || details.leadMetadata === null ? null : JSON.stringify(details.leadMetadata),
        details.completedFields === undefined || details.completedFields === null ? null : JSON.stringify(details.completedFields)],
    ) as GuardAuditRow[];
    if (!rows[0]?.id) {
      throw new Error(`GHL_GUARD_LOG_UPDATE_NOT_PERSISTED:${status}`);
    }
  }

  private async safeUpdateLog(logId: string | null, status: string, details: Record<string, unknown>): Promise<void> {
    try {
      await this.updateLog(logId, status, details);
    } catch (error) {
      this.logAuditError('GHL_GUARD_LOG_UPDATE_FAILED', error, { logId, status });
    }
  }

  private logAuditError(code: string, error: unknown, context: Record<string, unknown> = {}): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`${code}: ${message}`, JSON.stringify(context));
  }
}
