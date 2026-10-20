import { InjectDataSource } from '@nestjs/typeorm';
import { Injectable, Optional } from '@nestjs/common';
import type { Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

type RawBodyRequest = Request & { rawBody?: Buffer; webhookIngressRequestId?: string };

type AuditPayload = Record<string, unknown>;

const DEFAULT_STALE_INGRESS_MS = 2 * 60 * 1000;

export type WebhookIngressCompletion = {
  statusCode: number;
  connectionClosed?: boolean;
};

function asRecord(value: unknown): AuditPayload {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AuditPayload : {};
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
}

function jsonBody(request: RawBodyRequest, body: unknown): { rawBody: string; payload: AuditPayload } {
  const rawBody = request.rawBody?.toString('utf8') ?? (typeof body === 'string' ? body : JSON.stringify(body ?? {}));
  try {
    return { rawBody, payload: asRecord(JSON.parse(rawBody)) };
  } catch {
    return { rawBody, payload: asRecord(body) };
  }
}

function extractSource(path: string): string | null {
  const match = path.match(/\/webhooks\/ghl\/customer-replied\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function extractMetadata(path: string, payload: AuditPayload): {
  source: string | null;
  eventId: string | null;
  eventType: string | null;
  locationId: string | null;
  contactId: string | null;
  conversationId: string | null;
} {
  const lead = asRecord(payload.lead);
  const contact = asRecord(payload.contact);
  const conversation = asRecord(payload.conversation);
  const location = asRecord(payload.location);
  return {
    source: extractSource(path),
    eventId: firstText(payload.event_id, payload.eventId, payload.id),
    eventType: firstText(payload.event_type, payload.eventType, payload.type),
    locationId: firstText(payload.ghl_location_id, payload.location_id, location.id, lead.ghl_location_id, contact.location_id),
    contactId: firstText(payload.ghl_contact_id, payload.contact_id, contact.id, lead.ghl_contact_id),
    conversationId: firstText(payload.ghl_conversation_id, payload.conversation_id, conversation.id),
  };
}

function safeHeaders(request: RawBodyRequest): Record<string, string | null> {
  return {
    content_type: request.header('content-type') ?? null,
    user_agent: request.header('user-agent') ?? null,
    x_ghl_signature_present: request.header('X-GHL-Signature') ? 'true' : 'false',
    x_ghl_timestamp: request.header('X-GHL-Timestamp') ?? null,
    x_dealeradmin_secret_present: request.header('X-DealerADMIN-Webhook-Secret') ? 'true' : 'false',
    x_dealeradmin_contact_id: request.header('X-DealerADMIN-Contact-ID') ?? null,
    x_dealeradmin_conversation_id: request.header('X-DealerADMIN-Conversation-ID') ?? null,
    x_dealeradmin_message_id: request.header('X-DealerADMIN-Message-ID') ?? null,
  };
}

function outcomeForStatus(statusCode: number, connectionClosed = false): string {
  if (connectionClosed) return 'connection_closed';
  if (statusCode >= 200 && statusCode < 300) return 'accepted';
  if (statusCode >= 400 && statusCode < 500) return 'rejected';
  if (statusCode >= 500) return 'failed';
  return 'completed';
}

function staleIngressMs(): number {
  const configured = Number(process.env.WEBHOOK_INGRESS_STALE_MS ?? DEFAULT_STALE_INGRESS_MS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_STALE_INGRESS_MS;
}

@Injectable()
export class WebhookIngressAuditService {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async begin(request: RawBodyRequest, body: unknown): Promise<string | undefined> {
    if (!this.dataSource) return undefined;
    const path = request.originalUrl || request.url || '';
    if (!path.toLowerCase().includes('/webhooks')) return undefined;

    const { rawBody, payload } = jsonBody(request, body);
    const metadata = extractMetadata(path, payload);
    const requestId = randomUUID();
    try {
      await this.dataSource.query(
        `INSERT INTO webhook_ingress_logs
          (request_id, method, path, source, event_id, event_type, ghl_location_id, ghl_contact_id,
           ghl_conversation_id, payload_hash, raw_body, payload, safe_headers)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
        [
          requestId,
          request.method,
          path,
          metadata.source,
          metadata.eventId,
          metadata.eventType,
          metadata.locationId,
          metadata.contactId ?? request.header('X-DealerADMIN-Contact-ID') ?? null,
          metadata.conversationId ?? request.header('X-DealerADMIN-Conversation-ID') ?? null,
          createHash('sha256').update(rawBody).digest('hex'),
          rawBody,
          JSON.stringify(payload),
          JSON.stringify(safeHeaders(request)),
        ],
      );
      request.webhookIngressRequestId = requestId;
      return requestId;
    } catch {
      // Observability must never turn a webhook persistence problem into a second outage.
      return undefined;
    }
  }

  async markAuth(request: RawBodyRequest, status: 'accepted' | 'rejected', reason: string): Promise<void> {
    await this.update(request.webhookIngressRequestId, `auth_status = $2, auth_reason = $3`, [status, reason]);
  }

  async markHandlerStarted(request: RawBodyRequest): Promise<void> {
    await this.update(request.webhookIngressRequestId, 'handler_started_at = CURRENT_TIMESTAMP', []);
  }

  async markError(request: RawBodyRequest, error: unknown): Promise<void> {
    const errorCode = error instanceof Error ? error.message.slice(0, 500) : 'UNKNOWN_ERROR';
    await this.update(request.webhookIngressRequestId, 'error_code = $2', [errorCode]);
  }

  async complete(requestId: string | undefined, completion: WebhookIngressCompletion): Promise<void> {
    if (!requestId) return;
    const outcome = outcomeForStatus(completion.statusCode, completion.connectionClosed);
    await this.update(requestId, `status_code = $2, outcome = $3, completed_at = CURRENT_TIMESTAMP,
      duration_ms = FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - received_at)) * 1000)::integer`,
    [completion.statusCode, outcome]);
  }

  /**
   * Closes audit rows left in `received` after a process/connection failure.
   * The raw payload remains available for investigation; this method never
   * replays the webhook and therefore cannot duplicate business data.
   */
  async recoverStale(now = new Date()): Promise<number> {
    if (!this.dataSource) return 0;
    const staleBefore = new Date(now.getTime() - staleIngressMs()).toISOString();
    try {
      const rows = await this.dataSource.query(
        `UPDATE webhook_ingress_logs
         SET outcome = 'failed',
             error_code = COALESCE(error_code, 'WEBHOOK_INGRESS_STALE'),
             completed_at = COALESCE(completed_at, $1::timestamptz),
             duration_ms = COALESCE(duration_ms,
               GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - received_at)) * 1000)::integer)
         WHERE outcome = 'received'
           AND completed_at IS NULL
           AND received_at < $2::timestamptz
         RETURNING request_id`,
        [now.toISOString(), staleBefore],
      ) as Array<{ request_id: string }>;
      return rows.length;
    } catch {
      // Audit repair must never block due releases or Guard recovery.
      return 0;
    }
  }

  private async update(requestId: string | undefined, setClause: string, values: unknown[]): Promise<void> {
    if (!requestId || !this.dataSource) return;
    try {
      await this.dataSource.query(
        `UPDATE webhook_ingress_logs SET ${setClause} WHERE request_id = $1`,
        [requestId, ...values],
      );
    } catch {
      // Logging is deliberately non-blocking for the business request.
    }
  }
}
