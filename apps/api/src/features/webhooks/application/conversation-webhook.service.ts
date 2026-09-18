import { BadRequestException, Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { GhlCustomerRepliedDto } from '@dealeradmin/contracts';
import { GhlCustomerRepliedSchema } from '@dealeradmin/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { buildWhatsAppMessage } from '../../leads/domain/message-builder';
import { detectLeadLanguage, extractRecentMessagePhone, hasMinimumRoutingQualification, isAdvisorHandoffVehicle, isQualificationComplete, normalizeCollectorInput, normalizeRealName, type CollectorLanguage, type QualificationProgress } from '../../leads/domain/collector-normalizer';
import { evaluateDownPayment, normalizeDownPayment } from '../../leads/domain/down-payment';
import { normalizePhone } from '../../leads/domain/phone-normalizer';
import { GeoroutingService } from '../../routing/domain/services/georouting.service';
import { extractConversationLocation, extractLocationCandidates } from './conversation-location';
import { recordTestConversationEvent } from './test-conversation-store';
import { findQueuedConversationDuplicate } from '../../leads/domain/lead-duplicate';
import { normalizeGhlAttachments } from '../domain/ghl-attachment-normalizer';
import { isQueuedPauseSourceEnabled, isQueuedTransition, QUEUED_PAUSE_HOURS, type QueuedPauseNotifier, type QueuedPausePayload } from './conversation-bot-pause';
import { QUEUED_PAUSE_NOTIFIER } from '../presentation/queued-pause.tokens';

type SourceKey = 'stafford' | 'fredericksburg' | 'fredericksburg-2' | 'easterns' | 'arlington' | 'koons-fred' | 'koons-fred-eng' | 'koons-culpeper' | 'action-cars' | 'easterns-millersville' | 'easterns-frederick';

export const CONVERSATION_STABILIZATION_MS = 15_000;
export const INCOMPLETE_QUALIFICATION_WINDOW_HOURS = 0.5;
export const OUT_OF_WINDOW_QUALIFICATION_WINDOW_HOURS = 3;
export const QUALIFICATION_RULE_TIMEZONE = 'America/Bogota';
export const DUE_CONVERSATION_POLL_MS = 30_000;
export const DUE_CONVERSATION_BATCH_SIZE = 5;
export const ACTIVE_RECONCILIATION_BATCH_SIZE = 5;
export const STALE_PHONE_REENTRY_DAYS = 3;

export const GHL_SOURCE_CONFIG: Record<SourceKey, { locationId: string; defaultChannel: 'whatsapp' | 'messenger'; splitByLanguage?: boolean; alternatingGroup?: string }> = {
  stafford: { locationId: 'LiaoSID3nvAhad49ZpNJ', defaultChannel: 'whatsapp' },
  fredericksburg: { locationId: 'MyxWNKacThim798E8KC6', defaultChannel: 'messenger' },
  'fredericksburg-2': { locationId: 'bAuMEQeH48xAtu9tAMFf', defaultChannel: 'messenger' },
  easterns: { locationId: 'xN2LSSl62okzv9GnOJPU', defaultChannel: 'messenger' },
  arlington: { locationId: '9v8zH9Y5eLiiJwZTZDci', defaultChannel: 'messenger' },
  'koons-fred': { locationId: 'xuHo0opTO2g5edIuPJRl', defaultChannel: 'messenger' },
  'koons-fred-eng': { locationId: 'ozAIEblxTjrh0PfoaHge', defaultChannel: 'messenger' },
  'koons-culpeper': { locationId: 'bTNJHpNZ8FaS1PUHkuUq', defaultChannel: 'messenger' },
  'action-cars': { locationId: 'ZxadcudjvBz7KFCB1od4', defaultChannel: 'messenger', splitByLanguage: true },
  'easterns-millersville': { locationId: '113zMWQlhKKBUu5wOYtR', defaultChannel: 'messenger', alternatingGroup: 'easterns-millersville' },
  'easterns-frederick': { locationId: 'MRHcOwdTqaN5cug3eSWW', defaultChannel: 'messenger' },
};

type LeadRow = { id: string; canonical_phone: string | null; first_name: string | null; last_name: string | null };
type DealerRow = { id: string; code: string; name: string; timezone: string; routing_config: { group?: string; language?: CollectorLanguage; allocation_key?: string; allocation_order?: number } | null };
type ConversationRow = { id: string; status: string; qualification_snapshot: Record<string, unknown>; location_snapshot: Record<string, unknown>; ready_at?: string | null; isExisting?: boolean };
type ConversationMessageRow = {
  body: string;
  direction: string;
  occurred_at: string;
  raw_payload?: unknown;
  attachment_extracted_text?: string | null;
};

function addProcessedImageEvidence(messages: ConversationMessageRow[]): ConversationMessageRow[] {
  return messages.flatMap((message) => message.attachment_extracted_text
    ? [message, {
      body: message.attachment_extracted_text,
      direction: 'inbound',
      occurred_at: message.occurred_at,
      raw_payload: { source: 'image_ocr_attachment_fallback' },
    }]
    : [message]);
}

function hasAttachmentValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasAttachmentValue);
  return true;
}
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
  customer_location?: string;
  vehicle_category?: string | null;
  required_down_payment?: number | null;
  down_payment_amount?: number | null;
  down_payment_sufficient?: boolean;
  down_payment: string;
  purchase_timeline: string;
  documents: string;
  identification: string;
  bank_account: string;
  qualification_memory: string;
  qualification_complete: boolean;
  missing_qualification: string[];
  message_count: number;
  language?: CollectorLanguage;
  qualification_progress?: QualificationProgress;
  assigned_dealer_id?: string;
};

type LocationSnapshot = {
  city: string | null;
  state: string | null;
  zip_code: string | null;
  easterns_zone: string | null;
};

type QueuedPauseDispatch = { source: SourceKey; payload: QueuedPausePayload };

export type ConversationWebhookResponse = {
  accepted: true;
  eventId: string;
  conversationId: string;
  source: SourceKey;
  status: 'processed' | 'duplicate_ignored' | 'stale_phone_ignored';
};

export type DueConversationResponse = { accepted: true; processed: number };
export type MediaReconciliationResponse = {
  accepted: true;
  conversationId: string;
  status: string;
  qualificationSnapshot: ConversationSnapshot | null;
};

function clean(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function sourceKey(value: string): SourceKey {
  const source = value.trim().toLowerCase() as SourceKey;
  if (!(source in GHL_SOURCE_CONFIG)) throw new BadRequestException(`Fuente GHL no configurada: ${value}`);
  return source;
}

function isStaffordWhatsApp(source: SourceKey, channel: string): boolean {
  return source === 'stafford' && channel.trim().toLowerCase() === 'whatsapp';
}

function isOffleaseSource(source: SourceKey): boolean {
  return source === 'fredericksburg' || source === 'fredericksburg-2' || source === 'stafford';
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

function currentLocalNow(): Date {
  const fixed = process.env.DEALERADMIN_FIXED_NOW;
  if (fixed && process.env.NODE_ENV !== 'production') {
    const parsed = new Date(fixed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

@Injectable()
export class ConversationWebhookService implements OnModuleInit, OnModuleDestroy {
  private duePollTimer?: ReturnType<typeof setInterval>;
  private duePollInFlight = false;

  constructor(
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly georoutingService?: GeoroutingService,
    @Optional() @Inject(QUEUED_PAUSE_NOTIFIER) private readonly queuedPauseNotifier?: QueuedPauseNotifier,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.duePollTimer = setInterval(() => {
      void this.pollDueConversations();
      void this.dispatchPendingQueuedPauseEvents();
    }, DUE_CONVERSATION_POLL_MS);
    this.duePollTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.duePollTimer) clearInterval(this.duePollTimer);
    this.duePollTimer = undefined;
  }

  private async pollDueConversations(): Promise<void> {
    if (this.duePollInFlight) return;
    this.duePollInFlight = true;
    try {
      // The production timer calls the same reconciliation path exposed to
      // the operator/API, so the 30-second repair is real and testable.
      await this.processDueConversations(undefined, { reconcileActive: false });
    } catch {
      // The next poll or the operator queue read will retry due work. Polling
      // failures must never interrupt webhook handling or crash the process.
    } finally {
      this.duePollInFlight = false;
    }
  }

  private async reconcileActiveConversations(now: Date): Promise<void> {
    if (!this.dataSource) return;
    const rows = await this.dataSource.query(
      `SELECT id
       FROM conversations
       WHERE status IN ('partial', 'waiting_window')
       ORDER BY updated_at ASC
       LIMIT $1`,
      [ACTIVE_RECONCILIATION_BATCH_SIZE],
    ) as Array<{ id: string }>;
    for (const row of rows) await this.reconcileConversation(row.id, now);
  }

  /**
   * Re-run qualification after the media worker has inserted a derived
   * inbound message. The worker must not need database credentials for this;
   * it calls the guarded API endpoint instead.
   */
  async reconcileMediaConversation(id: string, now = currentLocalNow()): Promise<MediaReconciliationResponse> {
    if (!this.dataSource) throw new ServiceUnavailableException('Base de datos no disponible');
    await this.reconcileConversation(id, now);
    const rows = await this.dataSource.query(
      `SELECT status, qualification_snapshot
       FROM conversations
       WHERE id = $1`,
      [id],
    ) as Array<{ status: string; qualification_snapshot: ConversationSnapshot | null }>;
    if (!rows[0]) throw new BadRequestException('Conversación no encontrada');
    return {
      accepted: true,
      conversationId: id,
      status: rows[0].status,
      qualificationSnapshot: rows[0].qualification_snapshot,
    };
  }

  private async reconcileConversation(id: string, now: Date): Promise<void> {
    const runner = this.dataSource!.createQueryRunner();
    let queuedPauseEvent: QueuedPauseDispatch | null = null;
    await runner.connect();
    await runner.startTransaction();
    try {
      const rows = await runner.query(
        `SELECT c.id, c.channel, c.ghl_location_id, c.ghl_contact_id, c.ghl_conversation_id, c.status,
                c.qualification_snapshot, c.location_snapshot, c.ready_at,
                l.id AS lead_id, l.canonical_phone, l.first_name, l.last_name
         FROM conversations c
         JOIN leads l ON l.id = c.lead_id
         WHERE c.id = $1 AND c.status IN ('partial', 'waiting_window')
         FOR UPDATE`,
        [id],
      ) as Array<{
        id: string;
        channel: string;
        ghl_location_id: string;
        ghl_contact_id: string;
        ghl_conversation_id: string;
        status: string;
        qualification_snapshot: ConversationSnapshot;
        location_snapshot: LocationSnapshot;
        ready_at: string | null;
        lead_id: string;
        canonical_phone: string | null;
        first_name: string | null;
        last_name: string | null;
      }>;
      if (!rows[0]) {
        await runner.rollbackTransaction();
        return;
      }
      const row = rows[0];
      const configured = Object.entries(GHL_SOURCE_CONFIG).find(([, config]) => config.locationId === row.ghl_location_id);
      if (!configured) {
        await runner.rollbackTransaction();
        return;
      }
      const source = configured[0] as SourceKey;
      const current = row.qualification_snapshot ?? {} as ConversationSnapshot;
      const messages = await runner.query(
        `SELECT cm.body, cm.direction, cm.occurred_at, cm.raw_payload,
                ca.extracted_text AS attachment_extracted_text
         FROM conversation_messages cm
         LEFT JOIN conversation_attachments ca
           ON ca.conversation_message_id = cm.id
          AND ca.processing_status = 'done'
          AND ca.media_kind = 'image'
          AND ca.extracted_text IS NOT NULL
         WHERE cm.conversation_id = $1
         ORDER BY cm.occurred_at ASC, cm.created_at ASC`,
        [id],
      ) as ConversationMessageRow[];
      // The media worker normally inserts a derived inbound message. Keep a
      // direct attachment fallback as well: GHL never writes the OCR phone
      // into its native Contact Phone field, and a callback can arrive after
      // the attachment is marked done but before a derived-message read sees
      // it. The attachment itself is authoritative evidence tied to the
      // original inbound message timestamp.
      const evidenceMessages = addProcessedImageEvidence(messages);
      const transcript = evidenceMessages.map((item) => clean(item.body)).filter(Boolean).join('\n');
      if (!transcript) {
        await runner.rollbackTransaction();
        return;
      }
      const contactName = clean(`${row.first_name || ''} ${row.last_name || ''}`) || 'Lead';
      const recentPhone = this.safePhone(extractRecentMessagePhone(evidenceMessages, now));
      // Stafford is the only WhatsApp source. For WhatsApp, GHL's native
      // contact phone identifies the inbound sender even when the customer
      // never types the number in the conversation. Messenger must continue
      // to rely on recent inbound phone evidence.
      const nativeWhatsappPhone = isStaffordWhatsApp(source, row.channel)
        ? this.safePhone(row.canonical_phone) || this.extractNativeWhatsappPhone(messages)
        : null;
      const normalized = normalizeCollectorInput({
        source,
        channel: row.channel,
        message: transcript,
        chat_history_log: transcript,
        phone: recentPhone || nativeWhatsappPhone || '',
        // Reconciliation is incremental: feed the previous snapshot back into
        // the normalizer so a partial transcript cannot erase facts already
        // captured by GHL or an earlier poll.
        real_name: /(?:^|[^a-z])messenger(?:$|[^a-z])/i.test(row.channel) ? contactName : clean(current.real_name),
        vehicle_type: clean(current.vehicle_type),
        down_payment: clean(current.down_payment),
        purchase_timeline: clean(current.purchase_timeline),
        documents: clean(current.documents),
        identification: clean(current.identification),
        bank_account: clean(current.bank_account),
        qualification_memory: clean(current.qualification_memory),
        customer_location: clean(current.customer_location),
      });
      const effectivePhone = recentPhone || nativeWhatsappPhone || '';
      // A manual correction made while a conversation is waiting must survive
      // a later transcript reconciliation when GHL did not expose that answer.
      // Inbound evidence still wins whenever it is available.
      const realName = normalized.real_name || clean(current.real_name);
      const vehicle = normalized.vehicle_type || clean(current.vehicle_type);
      const downPayment = normalizeDownPayment(normalized.down_payment || clean(current.down_payment));
      const purchaseTimeline = normalized.purchase_timeline || clean(current.purchase_timeline);
      const documents = normalized.documents || clean(current.documents);
      const identification = normalized.identification || clean(current.identification);
      const bankAccount = normalized.bank_account || clean(current.bank_account);
      const downPaymentRule = evaluateDownPayment(vehicle, downPayment);
      const offlease = isOffleaseSource(source);
      const qualificationComplete = isQualificationComplete({
        real_name: realName,
        phone: effectivePhone,
        vehicle_type: vehicle,
        down_payment: downPayment,
        purchase_timeline: purchaseTimeline,
        has_identification: identification,
        has_income_proof: documents,
        bank_account: bankAccount,
      }) && (!offlease || downPaymentRule.meetsMinimum);
      const missingQualification = [
        !realName ? 'real_name' : '',
        !effectivePhone ? 'phone' : '',
        !vehicle || isAdvisorHandoffVehicle(vehicle) || (offlease && !downPaymentRule.category) ? 'vehicle_type' : '',
        !downPayment ? 'down_payment' : (offlease && !downPaymentRule.meetsMinimum ? 'down_payment_minimum' : ''),
        !purchaseTimeline ? 'purchase_timeline' : '',
        identification !== 'yes' ? 'identification' : '',
        !/proof of income|income proof|prueba de ingresos|comprobante de ingresos|estados? de cuenta|account statements?|bank statements?|financial statements?|pay stubs?|check stubs?|talones? de pago|colillas? de cheques?|recibos? de n[oó]mina/i.test(documents) ? 'proof_of_income' : '',
        bankAccount !== 'yes' ? 'bank_account' : '',
      ].filter(Boolean);
      const resolvedLocation = await this.resolveLocation(runner, transcript);
      const hasResolvedLocation = Boolean(resolvedLocation.city || resolvedLocation.state || resolvedLocation.zip_code || resolvedLocation.easterns_zone);
      const location = hasResolvedLocation ? resolvedLocation : (row.location_snapshot ?? { city: null, state: null, zip_code: null, easterns_zone: null });
      const language = configured[1].splitByLanguage ? detectLeadLanguage(transcript) : current.language;
      const snapshot: ConversationSnapshot = {
        real_name: realName,
        phone: effectivePhone,
        vehicle_type: vehicle,
        customer_location: normalized.customer_location || clean(current.customer_location),
        vehicle_category: downPaymentRule.category,
        required_down_payment: downPaymentRule.minimum,
        down_payment_amount: downPaymentRule.amount,
        down_payment_sufficient: downPaymentRule.meetsMinimum,
        down_payment: downPayment,
        purchase_timeline: purchaseTimeline,
        documents,
        identification,
        bank_account: bankAccount,
        qualification_memory: normalized.qualification_memory || clean(current.qualification_memory),
        qualification_complete: qualificationComplete,
        missing_qualification: missingQualification,
        message_count: messages.length,
        language,
        qualification_progress: normalized.qualification_progress,
        assigned_dealer_id: clean(current.assigned_dealer_id) || undefined,
      };
      const dealer = await this.findSourceDealer(runner, row.ghl_location_id, source, language, clean(current.assigned_dealer_id) || undefined);
      snapshot.assigned_dealer_id = dealer.id;
      if (snapshot.real_name) {
        const { firstName, lastName } = splitName(snapshot.real_name);
        await runner.query(
          `UPDATE leads SET first_name = $2, last_name = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [row.lead_id, firstName, lastName],
        );
      }
      if (effectivePhone && effectivePhone !== row.canonical_phone) {
        await runner.query(
          `UPDATE leads
           SET canonical_phone = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND NOT EXISTS (SELECT 1 FROM leads other WHERE other.canonical_phone = $2 AND other.id <> $1)`,
          [row.lead_id, effectivePhone],
        );
      }
      const status = this.statusForConversation(snapshot, location, dealer, source, now, 'due', row.ready_at);
      await runner.query(
        `UPDATE conversations
         SET status = $2::varchar, qualification_snapshot = $3::jsonb, location_snapshot = $4::jsonb,
             next_attempt_at = $5,
             ready_at = CASE
               WHEN $2::varchar IN ('ready', 'waiting_window', 'queued')
               THEN COALESCE(ready_at, $6::timestamptz)
               ELSE ready_at
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, status.status, JSON.stringify(snapshot), JSON.stringify(location), status.nextAttemptAt, now.toISOString()],
      );
      if (status.status === 'ready') {
        const duplicate = await findQueuedConversationDuplicate(
          runner,
          dealer.id,
          snapshot.real_name || contactName,
          snapshot.phone,
          id,
        );
        if (!duplicate) {
          await this.syncLeadDealer(runner, dealer, row.lead_id, snapshot, location, source);
          await runner.query(`UPDATE conversations SET status = 'queued', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
          queuedPauseEvent = await this.createQueuedPauseEvent(runner, row.status, 'queued', {
            conversationId: row.id,
            ghlConversationId: row.ghl_conversation_id,
            contactId: row.ghl_contact_id,
            locationId: row.ghl_location_id,
            leadId: row.lead_id,
            source,
            emittedAt: now,
          });
        } else {
          await runner.query(`UPDATE conversations SET status = 'duplicate_ignored', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        }
      }
      await runner.commitTransaction();
      if (queuedPauseEvent) await this.dispatchQueuedPauseEvent(queuedPauseEvent);
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      // Reconciliation is best effort. A single malformed row must not stop
      // the 30-second poll from repairing the remaining conversations.
      void error;
    } finally {
      await runner.release();
    }
  }

  async acceptCustomerReplied(
    input: unknown,
    sourceValue: string,
    headers: { contactId?: string; conversationId?: string; messageId?: string; testNow?: Date },
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
    if (source === 'stafford' && event.channel.trim().toLowerCase() !== 'whatsapp') {
      throw new UnprocessableEntityException('Stafford solo acepta conversaciones de WhatsApp');
    }
    const contactId = event.ghl_contact_id;
    const message = clean(event.message_body);
    const messageId = event.ghl_message_id || event.event_id || `event:${hash(JSON.stringify(event))}`;
    const attachments = normalizeGhlAttachments(event.message_attachments, messageId);
    if (!contactId) throw new UnprocessableEntityException('El webhook requiere el Contact ID nativo de GHL');
    if (!message && attachments.length === 0) {
      throw new UnprocessableEntityException('El webhook requiere el cuerpo del mensaje o al menos un attachment');
    }

    const conversationId = event.ghl_conversation_id || `contact:${contactId}:${event.channel}`;
    const raw = rawBody || JSON.stringify(input);
    const eventId = event.event_id || `ghl:${source}:${hash(raw)}`;
    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      recordTestConversationEvent({ eventId, source, contactId, conversationId, message, channel: event.channel, attachments: event.message_attachments });
      return { accepted: true, eventId, conversationId, source, status: 'processed' };
    }
    if (!this.dataSource) throw new ServiceUnavailableException('Database connection is not available');

    return this.persistEvent({ ...event, ghl_contact_id: contactId, ghl_conversation_id: conversationId, event_id: eventId }, source, raw, headers.testNow);
  }

  async processDueConversations(
    now = currentLocalNow(),
    options: { reconcileActive?: boolean } = {},
  ): Promise<DueConversationResponse> {
    if (!this.dataSource) {
      if (process.env.NODE_ENV === 'test') return { accepted: true, processed: 0 };
      throw new ServiceUnavailableException('Database connection is not available');
    }
    // Manual corrections may set waiting_window before next_attempt_at. Give those
    // rows an immediate due time so they cannot remain invisible indefinitely.
    await this.dataSource.query(
      `UPDATE conversations
       SET next_attempt_at = $1::timestamptz, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'waiting_window' AND next_attempt_at IS NULL`,
      [now.toISOString()],
    );
    const due = await this.dataSource.query(
      `SELECT c.id
       FROM conversations c
       WHERE c.status = 'waiting_window' AND c.next_attempt_at IS NOT NULL AND c.next_attempt_at <= $1
       ORDER BY c.next_attempt_at ASC
       LIMIT $2`,
      [now.toISOString(), DUE_CONVERSATION_BATCH_SIZE],
    ) as Array<{ id: string }>;
    let processed = 0;
    for (const row of due) {
      if (await this.releaseDueConversation(row.id, now)) processed += 1;
    }
    // Reconciliation is a bounded fallback for late fields/manual corrections.
    // External cron requests skip it so due-row release stays comfortably below
    // the serverless invocation limit. Incoming GHL events already reconcile
    // their own transcript synchronously.
    if (options.reconcileActive !== false) await this.reconcileActiveConversations(now);
    return { accepted: true, processed };
  }

  private normalizeInput(input: unknown, defaultChannel: string, headers: { contactId?: string; conversationId?: string; messageId?: string }): Record<string, unknown> {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const nestedContact = value.contact && typeof value.contact === 'object' ? value.contact as Record<string, unknown> : {};
    const nestedLocation = value.location && typeof value.location === 'object' ? value.location as Record<string, unknown> : {};
    const customData = value.customData && typeof value.customData === 'object' ? value.customData as Record<string, unknown> : {};
    const nestedMessage = value.message && typeof value.message === 'object' ? value.message as Record<string, unknown> : {};
    const triggerData = value.triggerData && typeof value.triggerData === 'object' ? value.triggerData as Record<string, unknown> : {};
    const triggerMessage = triggerData.message && typeof triggerData.message === 'object' ? triggerData.message as Record<string, unknown> : {};
    const nativeMessage = Object.keys(nestedMessage).length > 0 ? nestedMessage : triggerMessage;
    const attachmentValue = [
      value.message_attachments,
      value.messageAttachments,
      value.attachments,
      customData.message_attachments,
      customData.messageAttachments,
      customData.attachments,
      nativeMessage.message_attachments,
      nativeMessage.messageAttachments,
      nativeMessage.attachments,
      nativeMessage.media,
      nativeMessage.attachment,
      triggerData.message_attachments,
      triggerData.messageAttachments,
      triggerData.attachments,
    ].find(hasAttachmentValue);
    return {
      ...value,
      event_id: value.event_id ?? value.eventId,
      event_type: value.event_type ?? value.eventType ?? 'customer.replied',
      ghl_message_id: value.ghl_message_id ?? value.messageId ?? headers.messageId,
      ghl_contact_id: value.ghl_contact_id ?? value.contact_id ?? value.contactId ?? headers.contactId ?? nestedContact.id ?? value.id,
      ghl_conversation_id: value.ghl_conversation_id ?? value.conversation_id ?? value.conversationId ?? headers.conversationId,
      message_body: value.message_body
        ?? value.messageBody
        ?? customData.message_body
        ?? customData.messageBody
        ?? (typeof value.message === 'string' ? value.message : undefined)
        ?? nativeMessage.body
        ?? nativeMessage.text
        ?? value.body,
      contact_phone: value.contact_phone ?? customData.contact_phone ?? nestedContact.phone ?? value.phone,
      contact_name: value.contact_name ?? customData.contact_name ?? nestedContact.name ?? value.name ?? value.full_name,
      channel: value.channel ?? customData.channel ?? defaultChannel,
      occurred_at: value.occurred_at ?? value.occurredAt ?? value.date_updated ?? value.dateUpdated,
      message_attachments: attachmentValue,
      raw_payload: value.raw_payload ?? value,
      location: nestedLocation,
    };
  }

  private async persistEvent(event: GhlCustomerRepliedDto & { ghl_contact_id: string; ghl_conversation_id: string; event_id: string }, source: SourceKey, rawBody: string, controlledNow?: Date): Promise<ConversationWebhookResponse> {
    const runner = this.dataSource!.createQueryRunner();
    let queuedPauseEvent: QueuedPauseDispatch | null = null;
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

      // Existing sources have one dealer per Location ID and can fail fast.
      // Action intentionally shares one Location ID across its language queues,
      // so its dealer is selected after the transcript has been normalized.
      const sourceDealer = GHL_SOURCE_CONFIG[source].splitByLanguage || GHL_SOURCE_CONFIG[source].alternatingGroup
        ? undefined
        : await this.findSourceDealer(runner, GHL_SOURCE_CONFIG[source].locationId, source);
      const displayName = clean(event.contact_name) || 'Lead';
      const normalizedName = normalizeRealName(displayName) || displayName;
      const { firstName, lastName } = splitName(normalizedName);
      let lead = await this.upsertLead(runner, {
        locationId: GHL_SOURCE_CONFIG[source].locationId,
        contactId: event.ghl_contact_id,
        // Stafford WhatsApp's native contact phone is the sender identity;
        // Messenger continues to require recent inbound phone evidence.
        phone: isStaffordWhatsApp(source, event.channel)
          ? this.safePhone(event.contact_phone)
          : null,
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
      const insertedMessages = await runner.query(
        `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (conversation_id, dedupe_key) DO NOTHING
         RETURNING id`,
        [conversation.id, dedupeKey, messageId, String(event.message_body ?? '').replace(/\r\n?/g, '\n').trim(), receivedAt, JSON.stringify(event.raw_payload ?? event)],
      ) as Array<{ id: string }>;
      const conversationMessageId = insertedMessages[0]?.id ?? (await runner.query(
        `SELECT id FROM conversation_messages WHERE conversation_id = $1 AND dedupe_key = $2 LIMIT 1`,
        [conversation.id, dedupeKey],
      ) as Array<{ id: string }>)[0]?.id;
      await this.persistAttachments(runner, conversation.id, conversationMessageId, event, source, messageId);
      const messages = await runner.query(
        `SELECT cm.body, cm.direction, cm.occurred_at, cm.raw_payload,
                ca.extracted_text AS attachment_extracted_text
         FROM conversation_messages cm
         LEFT JOIN conversation_attachments ca
           ON ca.conversation_message_id = cm.id
          AND ca.processing_status = 'done'
          AND ca.media_kind = 'image'
          AND ca.extracted_text IS NOT NULL
         WHERE cm.conversation_id = $1
         ORDER BY cm.occurred_at ASC, cm.created_at ASC`,
        [conversation.id],
      ) as ConversationMessageRow[];
      const evidenceMessages = addProcessedImageEvidence(messages);
      const transcript = evidenceMessages
        .map((item) => String(item.body ?? '').replace(/\r\n?/g, '\n').trim())
        .filter(Boolean)
        .join('\n');
      const now = controlledNow ?? currentLocalNow();
      const recentPhone = this.safePhone(extractRecentMessagePhone(evidenceMessages, now));
      // On Stafford WhatsApp, the native contact phone is authoritative
      // sender identity. On Messenger, only recent inbound text evidence is
      // eligible, so a stale registered phone cannot enter the queue.
      const nativeWhatsappPhone = isStaffordWhatsApp(source, event.channel)
        ? this.safePhone(event.contact_phone) || this.extractNativeWhatsappPhone(messages)
        : null;
      if (conversation.isExisting && conversation.status === 'sent') {
        await runner.query(
          `UPDATE conversations
           SET last_message_at = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [conversation.id, receivedAt],
        );
        await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL WHERE event_id = $1`, [event.event_id]);
        await runner.commitTransaction();
        return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'processed' };
      }
      const normalized = normalizeCollectorInput({
        source,
        channel: event.channel,
        real_name: /(?:^|[^a-z])messenger(?:$|[^a-z])/i.test(event.channel) ? displayName : undefined,
        message: transcript,
        chat_history_log: transcript,
        phone: recentPhone || nativeWhatsappPhone || '',
      });
      // A lead can correct the phone in a later inbound message. Keep the
      // same GHL contact/lead identity and promote that conversational phone
      // to canonical_phone, unless another lead already owns it.
      const effectivePhone = recentPhone || nativeWhatsappPhone || '';
      if (effectivePhone && effectivePhone !== lead.canonical_phone) {
        const updatedLead = await runner.query(
          `UPDATE leads
           SET canonical_phone = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND NOT EXISTS (
               SELECT 1 FROM leads other
               WHERE other.canonical_phone = $2 AND other.id <> $1
             )
           RETURNING id, canonical_phone, first_name, last_name`,
          [lead.id, effectivePhone],
        ) as LeadRow[];
        if (updatedLead[0]) lead = updatedLead[0];
      }
      const location = await this.resolveLocation(runner, transcript);
      const language = GHL_SOURCE_CONFIG[source].splitByLanguage ? detectLeadLanguage(transcript) : undefined;
      const downPayment = normalizeDownPayment(normalized.down_payment);
      const downPaymentRule = evaluateDownPayment(normalized.vehicle_type, downPayment);
      const offlease = isOffleaseSource(source);
      const snapshot: ConversationSnapshot = {
        // Messenger uses the contact display name as real_name. WhatsApp
        // only receives a real_name when it was declared/repeated in chat.
        // Do not fall back to a stale snapshot: a contaminated previous value
        // must be removable on the next inbound message.
        real_name: normalized.real_name,
        phone: effectivePhone || '',
        vehicle_type: normalized.vehicle_type,
        customer_location: normalized.customer_location,
        vehicle_category: downPaymentRule.category,
        required_down_payment: downPaymentRule.minimum,
        down_payment_amount: downPaymentRule.amount,
        down_payment_sufficient: downPaymentRule.meetsMinimum,
        down_payment: downPayment,
        purchase_timeline: normalized.purchase_timeline,
        documents: normalized.documents,
        identification: normalized.identification,
        bank_account: normalized.bank_account,
        qualification_memory: normalized.qualification_memory,
        qualification_complete: isQualificationComplete({
          real_name: normalized.real_name,
          phone: effectivePhone,
          vehicle_type: normalized.vehicle_type,
          down_payment: downPayment,
          purchase_timeline: normalized.purchase_timeline,
          has_identification: normalized.identification,
          has_income_proof: normalized.documents,
          bank_account: normalized.bank_account,
        }) && (!offlease || downPaymentRule.meetsMinimum),
        missing_qualification: [
          !normalized.real_name ? 'real_name' : '',
          !effectivePhone ? 'phone' : '',
          !normalized.vehicle_type || isAdvisorHandoffVehicle(normalized.vehicle_type) || (offlease && !downPaymentRule.category) ? 'vehicle_type' : '',
          !downPayment ? 'down_payment' : (offlease && !downPaymentRule.meetsMinimum ? 'down_payment_minimum' : ''),
          !normalized.purchase_timeline ? 'purchase_timeline' : '',
          normalized.identification !== 'yes' ? 'identification' : '',
          normalized.has_income_proof !== 'yes' ? 'proof_of_income' : '',
          normalized.bank_account !== 'yes' ? 'bank_account' : '',
        ].filter(Boolean),
        message_count: messages.length,
        language,
        qualification_progress: normalized.qualification_progress,
      };
      const assignedDealerId = clean(conversation.qualification_snapshot?.assigned_dealer_id);
      const dealer = sourceDealer ?? await this.findSourceDealer(runner, GHL_SOURCE_CONFIG[source].locationId, source, language, assignedDealerId || undefined);
      snapshot.assigned_dealer_id = dealer.id;
      const stalePhone = snapshot.phone
        ? await this.findStalePhoneReentry(runner, snapshot.phone, now)
        : null;
      if (stalePhone) {
        await runner.query(
          `UPDATE conversations
           SET status = 'stale_phone_ignored', qualification_snapshot = $2::jsonb,
               location_snapshot = $3::jsonb, last_message_at = $4,
               next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [conversation.id, JSON.stringify(snapshot), JSON.stringify(location), receivedAt],
        );
        await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = $2 WHERE event_id = $1`, [event.event_id, `STALE_PHONE_REENTRY:${stalePhone.sent_at}`]);
        await runner.commitTransaction();
        return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'stale_phone_ignored' };
      }
      if (normalized.real_name) {
        const { firstName: normalizedFirstName, lastName: normalizedLastName } = splitName(normalized.real_name);
        await runner.query(
          `UPDATE leads
           SET first_name = $2, last_name = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [lead.id, normalizedFirstName, normalizedLastName],
        );
      }
      // Keep repeated inbound events for audit, but do not create a second
      // queue item when the same normalized identity is already queued.
      const queuedDuplicate = await findQueuedConversationDuplicate(
        runner,
        dealer.id,
        snapshot.real_name || normalizedName,
        snapshot.phone,
      );
      if (queuedDuplicate) {
        const isSameQueuedConversation = conversation.isExisting && queuedDuplicate.conversation_id === conversation.id;
        // A later inbound message can add the make/model after the lead was
        // initially queued. Keep the existing queue row synchronized with the
        // authoritative conversation snapshot (without touching its status).
        if (isSameQueuedConversation) {
          await this.syncLeadDealer(runner, dealer, lead.id, snapshot, location, source);
        }
        await runner.query(
          `UPDATE conversations
           SET status = $2::varchar, qualification_snapshot = $3::jsonb, location_snapshot = $4::jsonb,
               last_message_at = $5, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [conversation.id, isSameQueuedConversation ? 'queued' : 'duplicate_ignored', JSON.stringify(snapshot), JSON.stringify(location), receivedAt],
        );
        await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL WHERE event_id = $1`, [event.event_id]);
        await runner.commitTransaction();
        return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'processed' };
      }
      // Window rules are based on the server's current dealer-local time, not on
      // a delayed or replayed GHL timestamp from the message payload.
      const status = this.statusForConversation(snapshot, location, dealer, source, now, 'capture');
      await runner.query(
        `UPDATE conversations
         SET status = $2::varchar, qualification_snapshot = $3::jsonb, location_snapshot = $4::jsonb,
             last_message_at = $5, ready_at = CASE WHEN $2::varchar IN ('ready', 'waiting_window', 'queued') THEN COALESCE(ready_at, $7::timestamptz) ELSE ready_at END,
             next_attempt_at = $6, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
        [conversation.id, status.status, JSON.stringify(snapshot), JSON.stringify(location), receivedAt, status.nextAttemptAt, now.toISOString()],
      );
      if (status.status === 'ready') {
        await this.syncLeadDealer(runner, dealer, lead.id, snapshot, location, source);
        await runner.query(`UPDATE conversations SET status = 'queued', dispatched_at = NULL, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [conversation.id]);
        queuedPauseEvent = await this.createQueuedPauseEvent(runner, conversation.status, 'queued', {
          conversationId: conversation.id,
          ghlConversationId: event.ghl_conversation_id,
          contactId: event.ghl_contact_id,
          locationId: GHL_SOURCE_CONFIG[source].locationId,
          leadId: lead.id,
          source,
          emittedAt: now,
        });
      }
      await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL WHERE event_id = $1`, [event.event_id]);
      await runner.commitTransaction();
      if (queuedPauseEvent) await this.dispatchQueuedPauseEvent(queuedPauseEvent);
      return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'processed' };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await this.recordFailedEvent(event, rawBody, source, error);
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async createQueuedPauseEvent(
    runner: QueryRunner,
    previousStatus: string | null | undefined,
    nextStatus: string,
    input: {
      conversationId: string;
      ghlConversationId: string;
      contactId: string;
      locationId: string;
      leadId: string;
      source: SourceKey;
      emittedAt: Date;
    },
  ): Promise<QueuedPauseDispatch | null> {
    if (!isQueuedTransition(previousStatus, nextStatus) || !isQueuedPauseSourceEnabled(input.source)) return null;
    if (GHL_SOURCE_CONFIG[input.source].locationId !== input.locationId) {
      throw new BadRequestException(`Location ID no coincide con la fuente GHL ${input.source}`);
    }

    // The conversation row is locked by the surrounding transaction. The
    // counter gives each future queued re-entry its own durable identity.
    const sequenceRows = await runner.query(
      `SELECT COALESCE(MAX(transition_number), 0) + 1 AS transition_number
       FROM conversation_bot_pause_events
       WHERE conversation_id = $1`,
      [input.conversationId],
    ) as Array<{ transition_number: number | string }>;
    const transitionNumber = Math.max(1, Number(sequenceRows[0]?.transition_number) || 1);
    const emittedAt = input.emittedAt.toISOString();
    const pauseUntil = new Date(input.emittedAt.getTime() + QUEUED_PAUSE_HOURS * 60 * 60 * 1000).toISOString();
    const payload: QueuedPausePayload = {
      event: 'dealeradmin.conversation_queued',
      eventId: randomUUID(),
      queued: true,
      status: 'queued',
      conversationId: input.ghlConversationId,
      contactId: input.contactId,
      locationId: input.locationId,
      leadId: input.leadId,
      pauseHours: QUEUED_PAUSE_HOURS,
      emittedAt,
    };

    await runner.query(
      `INSERT INTO conversation_bot_pause_events
        (event_id, conversation_id, transition_number, ghl_conversation_id, ghl_contact_id,
         ghl_location_id, lead_id, queued, status, pause_hours, emitted_at, pause_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11)`,
      [payload.eventId, input.conversationId, transitionNumber, payload.conversationId, payload.contactId,
        payload.locationId, payload.leadId, payload.queued, payload.pauseHours, payload.emittedAt, pauseUntil],
    );
    return { source: input.source, payload };
  }

  private async dispatchQueuedPauseEvent(event: QueuedPauseDispatch): Promise<void> {
    if (!this.dataSource || !this.queuedPauseNotifier) return;
    try {
      const result = await this.queuedPauseNotifier.send(event.source, event.payload);
      if (!result.delivered) {
        await this.dataSource.query(
          `UPDATE conversation_bot_pause_events
           SET status = 'pending', last_error = $2, updated_at = CURRENT_TIMESTAMP
           WHERE event_id = $1 AND status <> 'sent'`,
          [event.payload.eventId, result.reason || 'webhook_not_configured'],
        );
        return;
      }
      await this.dataSource.query(
        `UPDATE conversation_bot_pause_events
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP, attempt_count = attempt_count + 1,
             last_error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE event_id = $1 AND status <> 'sent'`,
        [event.payload.eventId],
      );
    } catch (error) {
      const safeError = error instanceof Error && error.name === 'QueuedPauseDeliveryError'
        ? error.message.slice(0, 250)
        : 'Queued pause webhook delivery failed';
      await this.dataSource.query(
        `UPDATE conversation_bot_pause_events
         SET status = 'failed', attempt_count = attempt_count + 1, last_error = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE event_id = $1 AND status <> 'sent'`,
        [event.payload.eventId, safeError],
      );
    }
  }

  async dispatchPendingQueuedPauseEvents(): Promise<number> {
    if (!this.dataSource || !this.queuedPauseNotifier) return 0;
    const rows = await this.dataSource.query(
      `SELECT event_id, ghl_conversation_id, ghl_contact_id, ghl_location_id, lead_id, emitted_at
       FROM conversation_bot_pause_events
       WHERE status IN ('pending', 'failed')
       ORDER BY created_at ASC
       LIMIT 25`,
    ) as Array<{
      event_id: string;
      ghl_conversation_id: string;
      ghl_contact_id: string;
      ghl_location_id: string;
      lead_id: string;
      emitted_at: string | Date;
    }>;
    let processed = 0;
    for (const row of rows) {
      const configured = Object.entries(GHL_SOURCE_CONFIG).find(([, config]) => config.locationId === row.ghl_location_id);
      if (!configured) {
        await this.dataSource.query(
          `UPDATE conversation_bot_pause_events
           SET status = 'failed', attempt_count = attempt_count + 1,
               last_error = 'GHL source is not configured', updated_at = CURRENT_TIMESTAMP
           WHERE event_id = $1 AND status <> 'sent'`,
          [row.event_id],
        );
        continue;
      }
      if (!isQueuedPauseSourceEnabled(configured[0])) continue;
      await this.dispatchQueuedPauseEvent({
        source: configured[0] as SourceKey,
        payload: {
          event: 'dealeradmin.conversation_queued',
          eventId: row.event_id,
          queued: true,
          status: 'queued',
          conversationId: row.ghl_conversation_id,
          contactId: row.ghl_contact_id,
          locationId: row.ghl_location_id,
          leadId: row.lead_id,
          pauseHours: QUEUED_PAUSE_HOURS,
          emittedAt: new Date(row.emitted_at).toISOString(),
        },
      });
      processed += 1;
    }
    return processed;
  }

  private safePhone(value: string | null | undefined): string | null {
    const candidate = clean(value);
    if (!candidate) return null;
    try { return normalizePhone(candidate); } catch { return null; }
  }

  private async persistAttachments(
    runner: QueryRunner,
    conversationId: string,
    conversationMessageId: string | undefined,
    event: GhlCustomerRepliedDto & { ghl_contact_id: string; ghl_conversation_id: string; event_id: string },
    source: SourceKey,
    sourceMessageId: string,
  ): Promise<void> {
    if (!conversationMessageId) return;
    const attachments = normalizeGhlAttachments(event.message_attachments, sourceMessageId);
    for (const attachment of attachments) {
      await runner.query(
        `INSERT INTO conversation_attachments
          (conversation_id, conversation_message_id, ghl_location_id, ghl_conversation_id, ghl_message_id,
           source_url, source_url_expires_at, content_type, media_kind, original_filename, byte_size,
           processing_status, processing_metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, 'pending', $12::jsonb)
         ON CONFLICT (conversation_message_id, source_url) DO UPDATE SET
           content_type = COALESCE(EXCLUDED.content_type, conversation_attachments.content_type),
           media_kind = CASE WHEN conversation_attachments.media_kind = 'unknown' THEN EXCLUDED.media_kind ELSE conversation_attachments.media_kind END,
           original_filename = COALESCE(EXCLUDED.original_filename, conversation_attachments.original_filename),
           byte_size = COALESCE(EXCLUDED.byte_size, conversation_attachments.byte_size),
           source_url_expires_at = COALESCE(EXCLUDED.source_url_expires_at, conversation_attachments.source_url_expires_at),
           updated_at = CURRENT_TIMESTAMP`,
        [
          conversationId,
          conversationMessageId,
          GHL_SOURCE_CONFIG[source].locationId,
          event.ghl_conversation_id,
          sourceMessageId,
          attachment.sourceUrl,
          attachment.expiresAt,
          attachment.contentType,
          attachment.kind,
          attachment.filename,
          attachment.size,
          JSON.stringify({ source_id: attachment.sourceId, raw: attachment.raw }),
        ],
      );
    }
  }

  private extractNativeWhatsappPhone(messages: ConversationMessageRow[]): string | null {
    for (const message of [...messages].reverse()) {
      if (!message.raw_payload || typeof message.raw_payload !== 'object' || Array.isArray(message.raw_payload)) continue;
      const value = (message.raw_payload as Record<string, unknown>).contact_phone;
      const phone = this.safePhone(typeof value === 'string' ? value : null);
      if (phone) return phone;
    }
    return null;
  }

  private async findStalePhoneReentry(runner: QueryRunner, phone: string, now: Date): Promise<{ sent_at: string } | null> {
    const cutoff = new Date(now.getTime() - STALE_PHONE_REENTRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = await runner.query(
      `SELECT ld.sent_at
       FROM leads l
       INNER JOIN lead_dealers ld ON ld.lead_id = l.id
       WHERE l.canonical_phone = $1
         AND ld.status = 'sent'
         AND ld.sent_at IS NOT NULL
         AND ld.sent_at <= $2::timestamptz
       ORDER BY ld.sent_at ASC
       LIMIT 1`,
      [phone, cutoff],
    ) as Array<{ sent_at: string }>;
    return rows[0] ?? null;
  }

  private async findSourceDealer(runner: QueryRunner, locationId: string, source?: SourceKey, language?: CollectorLanguage, assignedDealerId?: string): Promise<DealerRow> {
    const rows = await runner.query(
      `SELECT d.id, d.code, d.name, d.timezone, d.routing_config
       FROM dealers d
       WHERE d.active = true AND (d.ghl_location_id = $1 OR EXISTS (SELECT 1 FROM dealer_location_aliases a WHERE a.ghl_location_id = $1 AND a.dealer_id = d.id))
       ORDER BY d.created_at, d.id`,
      [locationId],
    ) as DealerRow[];
    if (rows.length === 0) throw new BadRequestException(`No existe dealer activo para la Location ID ${locationId}`);
    if (source === 'action-cars') {
      const selectedLanguage = language ?? 'es';
      const dealer = rows.find((row) => row.routing_config?.language === selectedLanguage);
      if (!dealer) throw new BadRequestException(`No existe dealer Action Pre Owned Cars configurado para el idioma ${selectedLanguage}`);
      return dealer;
    }
    const alternatingGroup = source ? GHL_SOURCE_CONFIG[source].alternatingGroup : undefined;
    if (alternatingGroup) {
      const candidates = rows
        .filter((row) => row.routing_config?.allocation_key === alternatingGroup)
        .sort((left, right) => (left.routing_config?.allocation_order ?? 0) - (right.routing_config?.allocation_order ?? 0));
      if (assignedDealerId) {
        const assigned = candidates.find((row) => row.id === assignedDealerId);
        if (assigned) return assigned;
      }
      if (candidates.length < 2) throw new BadRequestException(`El grupo alternado ${alternatingGroup} requiere al menos dos dealers activos`);
      await runner.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [alternatingGroup]);
      await runner.query(
        `INSERT INTO dealer_round_robin_state (allocation_key, next_index)
         VALUES ($1, 0)
         ON CONFLICT (allocation_key) DO NOTHING`,
        [alternatingGroup],
      );
      const state = await runner.query(
        `SELECT next_index FROM dealer_round_robin_state WHERE allocation_key = $1 FOR UPDATE`,
        [alternatingGroup],
      ) as Array<{ next_index: number }>;
      const nextIndex = Number(state[0]?.next_index ?? 0) % candidates.length;
      await runner.query(
        `UPDATE dealer_round_robin_state
         SET next_index = $2, updated_at = CURRENT_TIMESTAMP
         WHERE allocation_key = $1`,
        [alternatingGroup, (nextIndex + 1) % candidates.length],
      );
      return candidates[nextIndex];
    }
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
    if (existing[0]) return { ...existing[0], isExisting: true };
    const inserted = await runner.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, first_message_at, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id, status, qualification_snapshot, location_snapshot, ready_at`,
      [input.leadId, input.locationId, input.contactId, input.conversationId, input.channel, input.occurredAt],
    ) as ConversationRow[];
    return { ...inserted[0], isExisting: false };
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
    const offlease = isOffleaseSource(source);
    const downPaymentRule = evaluateDownPayment(snapshot.vehicle_type, snapshot.down_payment);
    const hasLocation = Boolean(location.city || location.state || location.easterns_zone || location.zip_code);
    const routingReady = Boolean(
      hasMinimumRoutingQualification({ phone: snapshot.phone }) &&
      (!offlease || (snapshot.vehicle_type && downPaymentRule.meetsMinimum)),
    );
    if (!routingReady) return { status: 'partial', nextAttemptAt: null };
    if (phase === 'capture') {
      return { status: 'waiting_window', nextAttemptAt: new Date(now.getTime() + CONVERSATION_STABILIZATION_MS).toISOString() };
    }
    // Easterns still needs a city/state before it can be georouted. The
    // initial phone-only event remains visible during stabilization, but it
    // must not be released into georouting without a location.
    if (isEasterns && !hasLocation) return { status: 'partial', nextAttemptAt: null };
    if (snapshot.qualification_complete) return { status: 'ready', nextAttemptAt: null };
    const delayHours = withinDispatchWindow(QUALIFICATION_RULE_TIMEZONE, now)
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
    {
      const candidates = [...new Set([
        ...(city ? [city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()] : []),
        ...extractLocationCandidates(transcript),
      ])];
      if (candidates.length === 0) return { city: city || null, state: state || null, zip_code: hints.zip_code, easterns_zone: hints.easterns_zone };
      const rows = await runner.query(
        `SELECT name, state_code
         FROM locations
         WHERE normalized_name = ANY($1::text[])
         ORDER BY CASE
           WHEN $2::varchar IS NOT NULL AND state_code = $2 THEN 0
           WHEN state_code = 'MD' THEN 1
           WHEN state_code = 'VA' THEN 2
           ELSE 3
         END, array_position($1::text[], normalized_name)
         LIMIT 1`,
        [candidates, state],
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
      ? await this.georoutingService.resolveDealer(
        { ...location, qualification_memory: snapshot.qualification_memory },
        runner,
        sourceDealer.id,
        GHL_SOURCE_CONFIG[source].locationId,
      )
      : { dealerId: sourceDealer.id, reason: `GHL ${source} source dealer` };
    const alreadySent = current?.status === 'sent';
    const preservesAssignment = Boolean(current?.routing_override || alreadySent);
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
    let queuedPauseEvent: QueuedPauseDispatch | null = null;
    await runner.connect();
    await runner.startTransaction();
    try {
      const rows = await runner.query(
        `SELECT c.id, c.ghl_location_id, c.ghl_contact_id, c.ghl_conversation_id, c.qualification_snapshot, c.location_snapshot, c.ready_at,
                l.id AS lead_id, l.first_name, l.last_name
         FROM conversations c
         JOIN leads l ON l.id = c.lead_id
         WHERE c.id = $1 AND c.status = 'waiting_window' AND c.next_attempt_at <= $2
         FOR UPDATE`,
        [id, now.toISOString()],
      ) as Array<{ id: string; ghl_location_id: string; ghl_contact_id: string; ghl_conversation_id: string; qualification_snapshot: ConversationSnapshot; location_snapshot: LocationSnapshot; ready_at: string | null; lead_id: string; first_name: string | null; last_name: string | null }>;
      if (!rows[0]) {
        await runner.rollbackTransaction();
        return false;
      }
      const row = rows[0];
      const configuredSource = Object.entries(GHL_SOURCE_CONFIG).find(([, config]) => config.locationId === row.ghl_location_id)?.[0];
      if (!configuredSource) throw new BadRequestException(`Fuente GHL no configurada para la Location ID ${row.ghl_location_id}`);
      const source = configuredSource as SourceKey;
      const dealer = await this.findSourceDealer(
        runner,
        row.ghl_location_id,
        source,
        row.qualification_snapshot.language,
        clean(row.qualification_snapshot.assigned_dealer_id) || undefined,
      );
      const status = this.statusForConversation(row.qualification_snapshot, row.location_snapshot, dealer, source, now, 'due', row.ready_at);
      if (status.status !== 'ready') {
        await runner.query(
          `UPDATE conversations
           SET status = $2,
               next_attempt_at = $3,
               ready_at = CASE
                 WHEN $2::varchar IN ('ready', 'waiting_window', 'queued')
                 THEN COALESCE(ready_at, $4::timestamptz)
                 ELSE ready_at
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
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
        await runner.query(
          `UPDATE conversations SET status = 'duplicate_ignored', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id],
        );
        await runner.commitTransaction();
        return false;
      }
      await this.syncLeadDealer(runner, dealer, row.lead_id, row.qualification_snapshot, row.location_snapshot, source);
      await runner.query(`UPDATE conversations SET status = 'queued', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
      queuedPauseEvent = await this.createQueuedPauseEvent(runner, 'waiting_window', 'queued', {
        conversationId: row.id,
        ghlConversationId: row.ghl_conversation_id,
        contactId: row.ghl_contact_id,
        locationId: row.ghl_location_id,
        leadId: row.lead_id,
        source,
        emittedAt: now,
      });
      await runner.commitTransaction();
      if (queuedPauseEvent) await this.dispatchQueuedPauseEvent(queuedPauseEvent);
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
