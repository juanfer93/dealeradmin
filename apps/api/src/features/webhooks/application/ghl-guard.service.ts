import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { normalizeGhlAttachments } from '../domain/ghl-attachment-normalizer';
import { hash, parseOccurredAt } from './functions/conversation-webhook.helpers';
import { GHL_SOURCE_CONFIG, RECONCILIATION_LOCATION_IDS } from './functions/conversation-webhook.config';
import type { SourceConfigMap, SourceKey } from './functions/conversation-webhook.types';
import { ConversationReconciliationFunctions } from './functions/conversation-reconciliation.functions';
import {
  ghlGuardBatchSize,
  ghlGuardConcurrency,
  GHL_GUARD_LOCK_KEY,
  ghlGuardEnabled,
  ghlGuardIntervalMs,
  ghlGuardStaleLogMs,
  GHL_GUARD_TOKEN_ENV_BY_SOURCE,
} from './ghl-guard.config';
import { GhlGuardClient, type GhlGuardMessage } from './ghl-guard.client';

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

export type GhlGuardRunResult = {
  enabled: boolean;
  skipped: boolean;
  selected: number;
  fetched: number;
  inserted: number;
  repaired: number;
  failed: number;
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
         WHERE status NOT IN ('queued', 'sent', 'duplicate_ignored', 'ignored_channel', 'stale_phone_ignored')
           AND ghl_location_id = ANY($2::text[])
         ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
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
      await this.log(runId, null, 'failed', { errorCode: error instanceof Error ? error.name : 'GHL_GUARD_RUN_FAILED' });
      result.failed += 1;
      return result;
    } finally {
      try { await lockRunner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [GHL_GUARD_LOCK_KEY]); } catch { /* best effort */ }
      await lockRunner.release();
      this.running = false;
    }
  }

  private async processRow(row: GuardConversationRow, runId: string, now: Date, result: GhlGuardRunResult): Promise<void> {
    const logId = await this.createLog(runId, row, 'pending', now);
    const startedAt = new Date();
    await this.updateLog(logId, 'running', { startedAt });
    try {
      const source = sourceForLocation(this.sourceConfig, row.ghl_location_id);
      if (!source) {
        result.failed += 1;
        await this.updateLog(logId, 'failed', { errorCode: 'SOURCE_NOT_CONFIGURED', finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
        return;
      }
      const token = process.env[GHL_GUARD_TOKEN_ENV_BY_SOURCE[source]]?.trim();
      if (!token) {
        result.failed += 1;
        await this.updateLog(logId, 'failed', { errorCode: 'GHL_TOKEN_MISSING', source, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
        return;
      }
      let effectiveRow = row;
      let conversationId = row.ghl_conversation_id?.trim() ?? '';
      let lookupMetadata: Record<string, unknown> = {};
      if (needsConversationLookup(row.ghl_conversation_id)) {
        if (!this.client.searchConversationByContact) {
          result.failed += 1;
          await this.updateLog(logId, 'failed', { errorCode: 'GHL_CONVERSATION_LOOKUP_UNAVAILABLE', source, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
          return;
        }
        const lookup = await this.client.searchConversationByContact(token, row.ghl_location_id, row.ghl_contact_id);
        lookupMetadata = { conversationLookup: { requestPath: lookup.requestPath, httpStatus: lookup.status, resolved: Boolean(lookup.data?.conversation?.id) } };
        if (!lookup.ok || !lookup.data?.conversation?.id) {
          result.failed += 1;
          await this.updateLog(logId, 'failed', {
            errorCode: lookup.errorCode || 'GHL_CONVERSATION_NOT_FOUND',
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
      const fetched = await this.client.listMessages(token, conversationId);
      if (!fetched.ok || !fetched.data) {
        result.failed += 1;
        await this.updateLog(logId, 'failed', {
          errorCode: fetched.errorCode || 'GHL_MESSAGES_READ_FAILED',
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
      await this.reconciliation.reconcileConversation(effectiveRow.id, now, true, true);
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
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        ...lookupMetadata,
      });
    } catch (error) {
      result.failed += 1;
      await this.updateLog(logId, 'failed', {
        errorCode: error instanceof Error ? error.name : 'GHL_GUARD_CONVERSATION_FAILED',
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

  private async recoverStaleLogs(now: Date): Promise<void> {
    try {
      await this.dataSource?.query(
        `UPDATE ghl_guard_logs
         SET status = 'failed',
             finished_at = $1::timestamptz,
             duration_ms = GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - COALESCE(started_at, scheduled_at))) * 1000)::integer,
             error_code = COALESCE(error_code, 'GHL_GUARD_STALE_RUN'),
             metadata = jsonb_set(
               metadata || jsonb_build_object('recoveredAt', $1::text, 'recoveryReason', 'stale_guard_log'),
               '{lifecycle}',
               COALESCE(metadata->'lifecycle', '[]'::jsonb) || jsonb_build_array('stale_recovered')
             )
         WHERE status IN ('pending', 'running')
           AND COALESCE(started_at, scheduled_at) < $1::timestamptz - ($2::integer * INTERVAL '1 millisecond')`,
        [now.toISOString(), ghlGuardStaleLogMs()],
      );
    } catch {
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
    } catch {
      // Guard telemetry must never block webhook processing or due release.
    }
  }

  private async createLog(runId: string, row: GuardConversationRow, status: string, scheduledAt: Date): Promise<string | null> {
    if (!this.dataSource) return null;
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO ghl_guard_logs
          (run_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, conversation_id, status, scheduled_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
         RETURNING id`,
        [runId, row.ghl_location_id, row.ghl_contact_id, row.ghl_conversation_id, row.id, status, scheduledAt.toISOString(), JSON.stringify({ lifecycle: ['pending'] })],
      ) as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async updateLog(logId: string | null, status: string, details: Record<string, unknown>): Promise<void> {
    if (!this.dataSource || !logId) return;
    try {
      const metadata = { ...details };
      delete metadata.startedAt;
      delete metadata.finishedAt;
      delete metadata.responsePayload;
      const explicitDuration = typeof details.durationMs === 'number' && Number.isFinite(details.durationMs)
        ? details.durationMs
        : null;
      const derivedDuration = details.startedAt instanceof Date && details.finishedAt instanceof Date
        ? details.finishedAt.getTime() - details.startedAt.getTime()
        : null;
      await this.dataSource.query(
        `UPDATE ghl_guard_logs
         SET status = $2,
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
             metadata = jsonb_set(metadata || $14::jsonb, '{lifecycle}',
               COALESCE(metadata->'lifecycle', '[]'::jsonb) || jsonb_build_array($15::text))
         WHERE id = $1`,
        [logId, status,
          details.startedAt instanceof Date ? details.startedAt.toISOString() : null,
          details.finishedAt instanceof Date ? details.finishedAt.toISOString() : null,
          explicitDuration ?? derivedDuration,
          details.fetchedMessages ?? null, details.insertedMessages ?? null, details.repairedMessages ?? null,
          details.reconciled === true ? true : null, details.httpStatus ?? null, details.requestPath ?? null,
          details.errorCode ?? null, details.responsePayload === undefined ? null : JSON.stringify(details.responsePayload), JSON.stringify(metadata), status],
      );
    } catch {
      // Audit persistence must never block conversation processing.
    }
  }
}
