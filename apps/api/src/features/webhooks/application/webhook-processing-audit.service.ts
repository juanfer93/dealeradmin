import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

type ProcessingRecord = {
  requestId?: string;
  eventId?: string;
  eventType?: string;
  source?: string;
  locationId?: string;
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  status: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
};

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function recordValue(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
}

function payloadMetadata(body: unknown) {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const contact = value.contact && typeof value.contact === 'object' ? value.contact as Record<string, unknown> : {};
  const conversation = value.conversation && typeof value.conversation === 'object' ? value.conversation as Record<string, unknown> : {};
  const location = value.location && typeof value.location === 'object' ? value.location as Record<string, unknown> : {};
  const customData = value.customData && typeof value.customData === 'object' ? value.customData as Record<string, unknown> : {};
  return {
    locationId: recordValue(value, 'ghl_location_id', 'location_id', 'locationId')
      || recordValue(location, 'id')
      || recordValue(customData, 'ghl_location_id', 'location_id', 'locationId'),
    contactId: recordValue(value, 'ghl_contact_id', 'contact_id') || recordValue(contact, 'id'),
    conversationId: recordValue(value, 'ghl_conversation_id', 'conversation_id') || recordValue(conversation, 'id'),
    messageId: recordValue(value, 'ghl_message_id', 'message_id', 'messageId'),
    eventType: recordValue(value, 'event_type', 'eventType', 'type'),
  };
}

@Injectable()
export class WebhookProcessingAuditService {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async record(record: ProcessingRecord): Promise<void> {
    if (!this.dataSource) return;
    try {
      await this.dataSource.query(
        `INSERT INTO webhook_processing_attempts
          (request_id, event_id, event_type, source, ghl_location_id, ghl_contact_id,
           ghl_conversation_id, ghl_message_id, processing_status, persisted_at,
           completed_at, duration_ms, error_code, metadata)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::varchar,
                CASE WHEN $9::varchar IN ('processed', 'duplicate_ignored', 'stale_phone_ignored') THEN CURRENT_TIMESTAMP ELSE NULL END,
                CURRENT_TIMESTAMP,
                FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(i.handler_started_at, i.received_at, CURRENT_TIMESTAMP))) * 1000)::integer,
                $10, $11::jsonb
         FROM (SELECT 1) AS fallback
         LEFT JOIN webhook_ingress_logs i ON i.request_id = $12::uuid`,
        [record.requestId ?? null, record.eventId ?? null, record.eventType ?? null, record.source ?? null,
          record.locationId ?? null, record.contactId ?? null, record.conversationId ?? null, record.messageId ?? null,
          record.status, record.errorCode ?? null, JSON.stringify(record.metadata ?? {}), record.requestId ?? null],
      );
    } catch {
      // Telemetry is best-effort and must never change the webhook outcome.
    }
  }

  async recordFromPayload(options: {
    requestId?: string;
    source: string;
    eventId?: string;
    status: string;
    errorCode?: string;
    body: unknown;
    headers?: { contactId?: string; conversationId?: string; messageId?: string };
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const metadata = payloadMetadata(options.body);
    await this.record({
      requestId: options.requestId,
      eventId: options.eventId,
      eventType: metadata.eventType ?? 'customer.replied',
      source: options.source,
      locationId: metadata.locationId ?? undefined,
      contactId: metadata.contactId ?? options.headers?.contactId,
      conversationId: metadata.conversationId ?? options.headers?.conversationId,
      messageId: metadata.messageId ?? options.headers?.messageId,
      status: options.status,
      errorCode: options.errorCode,
      metadata: { telemetry_version: 'webhook-processing.v1', ...(options.metadata ?? {}) },
    });
  }
}
