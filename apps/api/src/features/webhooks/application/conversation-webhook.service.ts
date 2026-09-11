import { BadRequestException, Injectable, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { GhlCustomerRepliedDto } from '@dealeradmin/contracts';
import { GhlCustomerRepliedSchema } from '@dealeradmin/contracts';
import { createHash } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { buildWhatsAppMessage } from '../../leads/domain/message-builder';
import { hasMinimumRoutingQualification, normalizeCollectorInput, normalizeRealName } from '../../leads/domain/collector-normalizer';
import { normalizeDownPayment } from '../../leads/domain/down-payment';
import { normalizePhone } from '../../leads/domain/phone-normalizer';
import { GeoroutingService } from '../../routing/domain/services/georouting.service';
import { extractConversationLocation } from './conversation-location';
import { recordTestConversationEvent } from './test-conversation-store';

type SourceKey = 'stafford' | 'fredericksburg' | 'fredericksburg-2' | 'easterns';

export const CONVERSATION_STABILIZATION_MS = 15_000;
export const INCOMPLETE_QUALIFICATION_WINDOW_HOURS = 0.5;
export const OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS = 3;

export const GHL_SOURCE_CONFIG: Record<SourceKey, { locationId: string; defaultChannel: 'whatsapp' | 'messenger' }> = {
  stafford: { locationId: 'LiaoSID3nvAhad49ZpNJ', defaultChannel: 'whatsapp' },
  fredericksburg: { locationId: 'MyxWNKacThim798E8KC6', defaultChannel: 'messenger' },
  'fredericksburg-2': { locationId: 'bAuMEQeH48xAtu9tAMFf', defaultChannel: 'messenger' },
  easterns: { locationId: 'xN2LSSl62okzv9GnOJPU', defaultChannel: 'messenger' },
};

type LeadRow = { id: string; canonical_phone: string | null; first_name: string | null; last_name: string | null };
type DealerRow = { id: string; code: string; name: string; timezone: string; routing_config: { group?: string } | null };
type ConversationRow = { id: string; status: string; qualification_snapshot: Record<string, unknown>; location_snapshot: Record<string, unknown>; ready_at?: string | null };
type ExistingDealerLead = {
  status: string;
  routing_status: string;
  assigned_dealer_id: string | null;
  routing_override: boolean;
  routing_reason: string | null;
  vehicle_type: string | null;
  down_payment: string | null;
  identification: string | null;
  bank_account: string | null;
  purchase_timeline: string | null;
  documents: string | null;
};

type ConversationSnapshot = {
  real_name: string;
  phone: string;
  vehicle_type: string;
  down_payment: string;
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
  qualification_memory: string;
  qualification_complete: boolean;
  missing_qualification: string[];
  message_count: number;
};

type LocationSnapshot = {
  city: string | null;
  state: string | null;
  zip_code: string | null;
  easterns_zone: string | null;
};

export type ConversationWebhookResponse = {
  accepted: true;
  eventId: string;
  conversationId: string;
  source: SourceKey;
  status: 'processed' | 'duplicate_ignored';
};

export type DueConversationResponse = { accepted: true; processed: number };

function clean(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function sourceKey(value: string): SourceKey {
  const source = value.trim().toLowerCase() as SourceKey;
  if (!(source in GHL_SOURCE_CONFIG)) throw new BadRequestException(`Fuente GHL no configurada: ${value}`);
  return source;
}

function parseOccurredAt(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function splitName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || 'Lead', lastName: parts.slice(1).join(' ') };
}

function withinDispatchWindow(timezone: string, now: Date): boolean {
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(now));
    return hour >= 3 && hour < 15;
  } catch {
    return false;
  }
}

function plusHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class ConversationWebhookService {
  constructor(
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly georoutingService?: GeoroutingService,
  ) {}

  async acceptCustomerReplied(
    input: unknown,
    sourceValue: string,
    headers: { contactId?: string; conversationId?: string; messageId?: string },
    rawBody?: string,
  ): Promise<ConversationWebhookResponse> {
    const source = sourceKey(sourceValue);
    const sourceConfig = GHL_SOURCE_CONFIG[source];
    const body = this.normalizeInput(input, sourceConfig.defaultChannel, headers);
    const parsed = GhlCustomerRepliedSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({ code: 'INVALID_CUSTOMER_REPLIED_PAYLOAD', issues: parsed.error.issues });
    }

    const event = parsed.data;
    const contactId = event.ghl_contact_id;
    const message = clean(event.message_body);
    if (!contactId) throw new UnprocessableEntityException('El webhook requiere el Contact ID nativo de GHL');
    if (!message) throw new UnprocessableEntityException('El webhook requiere el cuerpo del mensaje');

    const conversationId = event.ghl_conversation_id || `contact:${contactId}:${event.channel}`;
    const raw = rawBody || JSON.stringify(input);
    const eventId = event.event_id || `ghl:${source}:${hash(raw)}`;
    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      recordTestConversationEvent({ eventId, source, contactId, conversationId, message, channel: event.channel });
      return { accepted: true, eventId, conversationId, source, status: 'processed' };
    }
    if (!this.dataSource) throw new ServiceUnavailableException('Database connection is not available');

    return this.persistEvent({ ...event, ghl_contact_id: contactId, ghl_conversation_id: conversationId, event_id: eventId }, source, raw);
  }

  async processDueConversations(now = new Date()): Promise<DueConversationResponse> {
    if (!this.dataSource) {
      if (process.env.NODE_ENV === 'test') return { accepted: true, processed: 0 };
      throw new ServiceUnavailableException('Database connection is not available');
    }
    const due = await this.dataSource.query(
      `SELECT c.id
       FROM conversations c
       WHERE c.status = 'waiting_window' AND c.next_attempt_at <= $1
       ORDER BY c.next_attempt_at ASC
       LIMIT 100`,
      [now.toISOString()],
    ) as Array<{ id: string }>;
    let processed = 0;
    for (const row of due) {
      if (await this.releaseDueConversation(row.id, now)) processed += 1;
    }
    return { accepted: true, processed };
  }

  private normalizeInput(input: unknown, defaultChannel: string, headers: { contactId?: string; conversationId?: string; messageId?: string }): Record<string, unknown> {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const nestedContact = value.contact && typeof value.contact === 'object' ? value.contact as Record<string, unknown> : {};
    const nestedLocation = value.location && typeof value.location === 'object' ? value.location as Record<string, unknown> : {};
    const customData = value.customData && typeof value.customData === 'object' ? value.customData as Record<string, unknown> : {};
    return {
      ...value,
      event_id: value.event_id ?? value.eventId,
      event_type: value.event_type ?? value.eventType ?? 'customer.replied',
      ghl_message_id: value.ghl_message_id ?? value.messageId ?? headers.messageId,
      ghl_contact_id: value.ghl_contact_id ?? value.contact_id ?? value.contactId ?? headers.contactId ?? nestedContact.id ?? value.id,
      ghl_conversation_id: value.ghl_conversation_id ?? value.conversation_id ?? value.conversationId ?? headers.conversationId,
      message_body: value.message_body ?? value.messageBody ?? customData.message_body ?? value.message ?? value.body,
      contact_phone: value.contact_phone ?? customData.contact_phone ?? nestedContact.phone ?? value.phone,
      contact_name: value.contact_name ?? customData.contact_name ?? nestedContact.name ?? value.name ?? value.full_name,
      channel: value.channel ?? customData.channel ?? defaultChannel,
      occurred_at: value.occurred_at ?? value.occurredAt ?? value.date_updated ?? value.dateUpdated,
      location: nestedLocation,
    };
  }

  private async persistEvent(event: GhlCustomerRepliedDto & { ghl_contact_id: string; ghl_conversation_id: string; event_id: string }, source: SourceKey, rawBody: string): Promise<ConversationWebhookResponse> {
    const runner = this.dataSource!.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const receivedAt = parseOccurredAt(event.occurred_at);
      const insertedEvents = await runner.query(
        `INSERT INTO webhook_events (event_id, event_type, ghl_location_id, status, payload_hash, raw_transcript, capture_contract, capture_schema_version, received_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, '{}'::jsonb, 'dealeradmin.conversation.v1', $6)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.event_id, event.event_type, GHL_SOURCE_CONFIG[source].locationId, hash(rawBody), event.message_body ?? '', receivedAt],
      ) as Array<{ event_id: string }>;
      if (insertedEvents.length === 0) {
        await runner.rollbackTransaction();
        return { accepted: true, eventId: event.event_id, conversationId: event.ghl_conversation_id, source, status: 'duplicate_ignored' };
      }

      const dealer = await this.findSourceDealer(runner, GHL_SOURCE_CONFIG[source].locationId);
      const phone = this.safePhone(event.contact_phone);
      const displayName = clean(event.contact_name) || 'Lead';
      const normalizedName = normalizeRealName(displayName) || displayName;
      const { firstName, lastName } = splitName(normalizedName);
      const lead = await this.upsertLead(runner, {
        locationId: GHL_SOURCE_CONFIG[source].locationId,
        contactId: event.ghl_contact_id,
        phone,
        firstName,
        lastName,
      });
      const conversation = await this.upsertConversation(runner, {
        leadId: lead.id,
        locationId: GHL_SOURCE_CONFIG[source].locationId,
        contactId: event.ghl_contact_id,
        conversationId: event.ghl_conversation_id,
        channel: event.channel,
        occurredAt: receivedAt,
      });
      const messageId = event.ghl_message_id || event.event_id;
      const dedupeKey = event.ghl_message_id || event.event_id;
      await runner.query(
        `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (conversation_id, dedupe_key) DO NOTHING`,
        [conversation.id, dedupeKey, messageId, clean(event.message_body), receivedAt, JSON.stringify(event.raw_payload ?? event)],
      );
      const messages = await runner.query(
        `SELECT body FROM conversation_messages WHERE conversation_id = $1 ORDER BY occurred_at ASC, created_at ASC`,
        [conversation.id],
      ) as Array<{ body: string }>;
      const transcript = messages.map((item) => clean(item.body)).filter(Boolean).join('\n');
      const normalized = normalizeCollectorInput({
        message: transcript,
        chat_history_log: transcript,
        phone,
      });
      const location = await this.resolveLocation(runner, transcript);
      const snapshot: ConversationSnapshot = {
        real_name: normalized.real_name || normalizedName,
        phone: normalized.phone || phone || '',
        vehicle_type: normalized.vehicle_type,
        down_payment: normalizeDownPayment(normalized.down_payment),
        purchase_timeline: normalized.purchase_timeline,
        documents: normalized.documents,
        identification: normalized.identification,
        bank_account: normalized.bank_account,
        qualification_memory: normalized.qualification_memory,
        qualification_complete: normalized.qualification_complete,
        missing_qualification: normalized.missing_qualification,
        message_count: messages.length,
      };
      // Window rules are based on the server's current dealer-local time, not on
      // a delayed or replayed GHL timestamp from the message payload.
      const status = this.statusForConversation(snapshot, location, dealer, source, new Date(), 'capture');
      await runner.query(
        `UPDATE conversations
         SET status = $2::varchar, qualification_snapshot = $3::jsonb, location_snapshot = $4::jsonb,
             last_message_at = $5, ready_at = CASE WHEN $2::varchar IN ('ready', 'waiting_window', 'queued') THEN COALESCE(ready_at, CURRENT_TIMESTAMP) ELSE ready_at END,
             next_attempt_at = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [conversation.id, status.status, JSON.stringify(snapshot), JSON.stringify(location), receivedAt, status.nextAttemptAt],
      );
      if (status.status === 'ready') {
        await this.syncLeadDealer(runner, dealer, lead.id, snapshot, location, source);
        await runner.query(`UPDATE conversations SET status = 'queued', dispatched_at = NULL, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [conversation.id]);
      }
      await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL WHERE event_id = $1`, [event.event_id]);
      await runner.commitTransaction();
      return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'processed' };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await this.recordFailedEvent(event, rawBody, source, error);
      throw error;
    } finally {
      await runner.release();
    }
  }

  private safePhone(value: string | null | undefined): string | null {
    const candidate = clean(value);
    if (!candidate) return null;
    try { return normalizePhone(candidate); } catch { return null; }
  }

  private async findSourceDealer(runner: QueryRunner, locationId: string): Promise<DealerRow> {
    const rows = await runner.query(
      `SELECT d.id, d.code, d.name, d.timezone, d.routing_config
       FROM dealers d
       WHERE d.active = true AND (d.ghl_location_id = $1 OR EXISTS (SELECT 1 FROM dealer_location_aliases a WHERE a.ghl_location_id = $1 AND a.dealer_id = d.id))
       ORDER BY d.created_at, d.id`,
      [locationId],
    ) as DealerRow[];
    if (rows.length === 0) throw new BadRequestException(`No existe dealer activo para la Location ID ${locationId}`);
    if (rows.length > 1) throw new BadRequestException(`El Location ID ${locationId} está vinculado a más de un dealer activo`);
    return rows[0];
  }

  private async upsertLead(runner: QueryRunner, input: { locationId: string; contactId: string; phone: string | null; firstName: string; lastName: string }): Promise<LeadRow> {
    const existing = await runner.query(
      `SELECT id, canonical_phone, first_name, last_name FROM leads WHERE ghl_location_id = $1 AND ghl_contact_id = $2 FOR UPDATE`,
      [input.locationId, input.contactId],
    ) as LeadRow[];
    if (existing[0]) {
      const lead = existing[0];
      await runner.query(
        `UPDATE leads
         SET canonical_phone = COALESCE($1, canonical_phone),
             first_name = CASE WHEN NULLIF($2, '') IS NULL OR LOWER($2) = 'lead' THEN first_name ELSE $2 END,
             last_name = CASE WHEN NULLIF($3, '') IS NULL OR LOWER($2) = 'lead' THEN last_name ELSE $3 END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [input.phone, input.firstName, input.lastName, lead.id],
      );
      const hasRealName = Boolean(input.firstName && input.firstName.toLowerCase() !== 'lead');
      return {
        ...lead,
        canonical_phone: input.phone || lead.canonical_phone,
        first_name: hasRealName ? input.firstName : lead.first_name,
        last_name: hasRealName ? input.lastName : lead.last_name,
      };
    }
    const inserted = await runner.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, $2, $3, $4, $5, 'GHL Customer Replied') RETURNING id, canonical_phone, first_name, last_name`,
      [input.phone, input.firstName, input.lastName, input.contactId, input.locationId],
    ) as LeadRow[];
    return inserted[0];
  }

  private async upsertConversation(runner: QueryRunner, input: { leadId: string; locationId: string; contactId: string; conversationId: string; channel: string; occurredAt: string }): Promise<ConversationRow> {
    const existing = await runner.query(
      `SELECT id, status, qualification_snapshot, location_snapshot, ready_at FROM conversations
       WHERE ghl_location_id = $1 AND ghl_contact_id = $2 AND ghl_conversation_id = $3 FOR UPDATE`,
      [input.locationId, input.contactId, input.conversationId],
    ) as ConversationRow[];
    if (existing[0]) return existing[0];
    const inserted = await runner.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, first_message_at, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id, status, qualification_snapshot, location_snapshot, ready_at`,
      [input.leadId, input.locationId, input.contactId, input.conversationId, input.channel, input.occurredAt],
    ) as ConversationRow[];
    return inserted[0];
  }

  private statusForConversation(
    snapshot: ConversationSnapshot,
    location: LocationSnapshot,
    dealer: DealerRow,
    source: SourceKey,
    now: Date,
    phase: 'capture' | 'due',
    readyAt?: string | null,
  ): { status: 'partial' | 'ready' | 'waiting_window'; nextAttemptAt: string | null } {
    const isEasterns = dealer.routing_config?.group === 'Easterns';
    const hasLocation = Boolean(location.city || location.state || location.easterns_zone || location.zip_code);
    const routingReady = Boolean(
      hasMinimumRoutingQualification({ phone: snapshot.phone }) &&
      (!isEasterns || hasLocation) &&
      (source !== 'stafford' || snapshot.vehicle_type),
    );
    if (!routingReady) return { status: 'partial', nextAttemptAt: null };
    if (phase === 'capture') {
      return { status: 'waiting_window', nextAttemptAt: new Date(now.getTime() + CONVERSATION_STABILIZATION_MS).toISOString() };
    }
    if (snapshot.qualification_complete) return { status: 'ready', nextAttemptAt: null };
    const delayHours = withinDispatchWindow(dealer.timezone, now)
      ? INCOMPLETE_QUALIFICATION_WINDOW_HOURS
      : OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS;
    const windowStart = readyAt ? new Date(readyAt) : now;
    const windowDueAt = Number.isNaN(windowStart.getTime()) ? plusHours(now, delayHours) : plusHours(windowStart, delayHours);
    if (windowDueAt <= now) return { status: 'ready', nextAttemptAt: null };
    return { status: 'waiting_window', nextAttemptAt: windowDueAt.toISOString() };
  }

  private async resolveLocation(runner: QueryRunner, transcript: string): Promise<LocationSnapshot> {
    const hints = extractConversationLocation(transcript);
    let city = hints.city;
    let state = hints.state;
    if (city) {
      const rows = await runner.query(
        `SELECT name, state_code FROM locations WHERE normalized_name = $1 ORDER BY state_code LIMIT 1`,
        [city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()],
      ) as Array<{ name: string; state_code: string }>;
      if (rows[0]) {
        city = rows[0].name;
        state = state || rows[0].state_code;
      }
    }
    return { city: city || null, state: state || null, zip_code: hints.zip_code, easterns_zone: hints.easterns_zone };
  }

  private async syncLeadDealer(runner: QueryRunner, sourceDealer: DealerRow, leadId: string, snapshot: ConversationSnapshot, location: LocationSnapshot, source: SourceKey): Promise<void> {
    if (!this.georoutingService) throw new ServiceUnavailableException('Georouting service is not available');
    const existing = await runner.query(
      `SELECT status, routing_status, assigned_dealer_id, routing_override, routing_reason, vehicle_type, down_payment,
              identification, bank_account, purchase_timeline, documents
       FROM lead_dealers WHERE lead_id = $1 AND dealer_id = $2 FOR UPDATE`,
      [leadId, sourceDealer.id],
    ) as ExistingDealerLead[];
    const current = existing[0];
    const isEasterns = sourceDealer.routing_config?.group === 'Easterns';
    const routing = isEasterns
      ? await this.georoutingService.resolveDealer({ ...location, qualification_memory: snapshot.qualification_memory }, runner, sourceDealer.id)
      : { dealerId: sourceDealer.id, reason: `GHL ${source} source dealer` };
    const alreadySent = current?.status === 'sent';
    const preservesAssignment = Boolean(current?.routing_override || alreadySent || current?.assigned_dealer_id);
    const assignedDealerId = preservesAssignment ? current?.assigned_dealer_id || routing.dealerId : routing.dealerId;
    const messageText = buildWhatsAppMessage(snapshot.real_name || 'Lead', snapshot.phone, snapshot);
    await runner.query(
      `INSERT INTO lead_dealers
        (lead_id, dealer_id, vehicle_type, down_payment, identification, bank_account, purchase_timeline, documents,
         easterns_zone, assigned_dealer_id, routing_override, routing_reason, routing_status, status, message_text, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'resolved', $13, $14, CURRENT_TIMESTAMP)
       ON CONFLICT (lead_id, dealer_id) DO UPDATE SET
         vehicle_type = COALESCE(NULLIF(EXCLUDED.vehicle_type, ''), lead_dealers.vehicle_type),
         down_payment = COALESCE(NULLIF(EXCLUDED.down_payment, ''), lead_dealers.down_payment),
         identification = COALESCE(NULLIF(EXCLUDED.identification, ''), lead_dealers.identification),
         bank_account = COALESCE(NULLIF(EXCLUDED.bank_account, ''), lead_dealers.bank_account),
         purchase_timeline = COALESCE(NULLIF(EXCLUDED.purchase_timeline, ''), lead_dealers.purchase_timeline),
         documents = COALESCE(NULLIF(EXCLUDED.documents, ''), lead_dealers.documents),
         easterns_zone = COALESCE(NULLIF(EXCLUDED.easterns_zone, ''), lead_dealers.easterns_zone),
         assigned_dealer_id = CASE WHEN lead_dealers.status = 'sent' OR lead_dealers.routing_override THEN lead_dealers.assigned_dealer_id ELSE EXCLUDED.assigned_dealer_id END,
         routing_reason = CASE WHEN lead_dealers.status = 'sent' OR lead_dealers.routing_override THEN lead_dealers.routing_reason ELSE EXCLUDED.routing_reason END,
         status = CASE WHEN lead_dealers.status = 'sent' THEN 'sent' ELSE 'pending' END,
         message_text = EXCLUDED.message_text,
         updated_at = CURRENT_TIMESTAMP`,
      [
        leadId, sourceDealer.id, snapshot.vehicle_type, normalizeDownPayment(snapshot.down_payment), snapshot.identification,
        snapshot.bank_account, snapshot.purchase_timeline, snapshot.documents, location.easterns_zone || '', assignedDealerId,
        current?.routing_override ?? false, current?.routing_reason || routing.reason, current?.status === 'sent' ? 'sent' : 'pending', messageText,
      ],
    );
  }

  private async releaseDueConversation(id: string, now: Date): Promise<boolean> {
    const runner = this.dataSource!.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const rows = await runner.query(
        `SELECT c.id, c.ghl_location_id, c.ghl_contact_id, c.qualification_snapshot, c.location_snapshot, c.ready_at,
                l.id AS lead_id, d.id AS dealer_id, d.code, d.name, d.timezone, d.routing_config
         FROM conversations c
         JOIN leads l ON l.id = c.lead_id
         JOIN dealers d ON d.active = true AND (
           d.ghl_location_id = c.ghl_location_id
           OR EXISTS (SELECT 1 FROM dealer_location_aliases a WHERE a.ghl_location_id = c.ghl_location_id AND a.dealer_id = d.id)
         )
         WHERE c.id = $1 AND c.status = 'waiting_window' AND c.next_attempt_at <= $2
         FOR UPDATE`,
        [id, now.toISOString()],
      ) as Array<{ id: string; ghl_location_id: string; qualification_snapshot: ConversationSnapshot; location_snapshot: LocationSnapshot; ready_at: string | null; lead_id: string; dealer_id: string; code: string; name: string; timezone: string; routing_config: { group?: string } | null }>;
      if (!rows[0]) {
        await runner.rollbackTransaction();
        return false;
      }
      const row = rows[0];
      const source = (Object.entries(GHL_SOURCE_CONFIG).find(([, config]) => config.locationId === row.ghl_location_id)?.[0] ?? (row.code === 'STAFFORD' ? 'stafford' : row.routing_config?.group === 'Easterns' ? 'easterns' : 'fredericksburg')) as SourceKey;
      const dealer: DealerRow = { id: row.dealer_id, code: row.code, name: row.name, timezone: row.timezone, routing_config: row.routing_config };
      const status = this.statusForConversation(row.qualification_snapshot, row.location_snapshot, dealer, source, now, 'due', row.ready_at);
      if (status.status !== 'ready') {
        await runner.query(
          `UPDATE conversations SET status = $2, next_attempt_at = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id, status.status, status.nextAttemptAt],
        );
        await runner.commitTransaction();
        return false;
      }
      await this.syncLeadDealer(runner, dealer, row.lead_id, row.qualification_snapshot, row.location_snapshot, source);
      await runner.query(`UPDATE conversations SET status = 'queued', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
      await runner.commitTransaction();
      return true;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async recordFailedEvent(event: GhlCustomerRepliedDto & { ghl_contact_id: string; ghl_conversation_id: string; event_id: string }, rawBody: string, source: SourceKey, error: unknown): Promise<void> {
    if (!this.dataSource) return;
    try {
      await this.dataSource.query(
        `INSERT INTO webhook_events (event_id, event_type, ghl_location_id, status, error_code, payload_hash, raw_transcript, capture_contract, capture_schema_version)
         VALUES ($1, $2, $3, 'failed', $4, $5, $6, '{}'::jsonb, 'dealeradmin.conversation.v1')
         ON CONFLICT (event_id) DO UPDATE SET status = 'failed', error_code = EXCLUDED.error_code, payload_hash = EXCLUDED.payload_hash`,
        [event.event_id, event.event_type, GHL_SOURCE_CONFIG[source].locationId, error instanceof Error ? error.message.slice(0, 250) : 'UNKNOWN_ERROR', hash(rawBody), event.message_body ?? ''],
      );
    } catch {
      // Never hide the original webhook error behind audit logging.
    }
  }
}
