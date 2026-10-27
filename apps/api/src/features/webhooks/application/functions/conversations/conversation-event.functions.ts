import type { DataSource, QueryRunner } from 'typeorm';
import { detectLeadLanguage, extractRecentMessagePhone, isAdvisorHandoffVehicle, isQualificationComplete, normalizeCollectorInput, normalizeRealName } from '../../../../leads/domain/collector-normalizer';
import { evaluateDownPayment, normalizeDownPayment } from '../../../../leads/domain/down-payment';
import { findQueuedConversationDuplicate } from '../../../../leads/domain/lead-duplicate';
import { normalizeGhlAttachments } from '../../../domain/ghl-attachment-normalizer';
import { ConversationQueueService, type QueuedPauseDispatch } from './conversation-queue.service';
import { ConversationQualificationFunctions } from './conversation-qualification.functions';
import { GHL_SOURCE_CONFIG, WAITING_WINDOW_RETRY_INTERVAL_MS } from './conversation-webhook.config';
import {
  addProcessedImageEvidence,
  clean,
  currentLocalNow,
  extractNativeWhatsappPhone,
  hash,
  isAttachmentEvidenceMessage,
  isStaffordWhatsApp,
  normalizeWebhookInput,
  parseOccurredAt,
  safePhone,
  splitName,
} from './conversation-webhook.helpers';
import type {
  ConversationMessageRow,
  ConversationSnapshot,
  ConversationWebhookResponse,
  PersistedWebhookEvent,
  SourceConfigMap,
  SourceKey,
} from './conversation-webhook.types';
import { configureWebhookTransactionSafety } from '../../transaction-safety';

export class ConversationEventFunctions {
  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly qualification: ConversationQualificationFunctions,
    private readonly queueService: ConversationQueueService,
    private readonly sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
  ) {}

  normalizeInput(input: unknown, defaultChannel: string, headers: { contactId?: string; conversationId?: string; messageId?: string }): Record<string, unknown> {
    return normalizeWebhookInput(input, defaultChannel, headers);
  }

  async persistEvent(event: PersistedWebhookEvent, source: SourceKey, rawBody: string, controlledNow?: Date): Promise<ConversationWebhookResponse> {
    const runner = this.dataSource!.createQueryRunner();
    const locationId = event.ghl_location_id || this.sourceConfig[source].locationId;
    let queuedPauseEvent: QueuedPauseDispatch | null = null;
    await runner.connect();
    await runner.startTransaction();
    try {
      await configureWebhookTransactionSafety(runner);
      const occurredAt = parseOccurredAt(event.occurred_at);
      const insertedEvents = await runner.query(
        `INSERT INTO webhook_events (event_id, event_type, ghl_location_id, status, payload_hash, raw_transcript, capture_contract, capture_schema_version, received_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, '{}'::jsonb, 'dealeradmin.conversation.v1', CURRENT_TIMESTAMP)
         ON CONFLICT (event_id) DO UPDATE
           SET status = 'pending', error_code = NULL, received_at = CURRENT_TIMESTAMP
           WHERE webhook_events.status = 'failed'
         RETURNING event_id`,
        [event.event_id, event.event_type, locationId, hash(rawBody), event.message_body ?? ''],
      ) as Array<{ event_id: string }>;
      if (insertedEvents.length === 0) {
        await runner.rollbackTransaction();
        return { accepted: true, eventId: event.event_id, conversationId: event.ghl_conversation_id, source, status: 'duplicate_ignored' };
      }

      const sourceDealer = this.sourceConfig[source].splitByLanguage || this.sourceConfig[source].alternatingGroup
        ? undefined
        : await this.qualification.findSourceDealer(runner, locationId, source);
      const displayName = clean(event.contact_name) || 'Lead';
      const normalizedName = normalizeRealName(displayName) || 'Lead';
      const { firstName, lastName } = splitName(normalizedName);
      let lead = await this.qualification.upsertLead(runner, {
        locationId,
        contactId: event.ghl_contact_id,
        phone: isStaffordWhatsApp(source, event.channel) ? safePhone(event.contact_phone) : null,
        firstName,
        lastName,
      });
      const conversation = await this.qualification.upsertConversation(runner, {
        leadId: lead.id,
        locationId,
        contactId: event.ghl_contact_id,
        conversationId: event.ghl_conversation_id,
        channel: event.channel,
        occurredAt,
        dealerId: sourceDealer?.id,
      });
      const messageId = event.ghl_message_id || event.event_id;
      const dedupeKey = event.ghl_message_id || event.event_id;
      const insertedMessages = await runner.query(
        `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (conversation_id, dedupe_key) DO NOTHING
         RETURNING id`,
        [conversation.id, dedupeKey, messageId, String(event.message_body ?? '').replace(/\r\n?/g, '\n').trim(), occurredAt, JSON.stringify(event.raw_payload ?? event)],
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
      const recentPhone = safePhone(extractRecentMessagePhone(evidenceMessages.map((message) => ({
        ...message,
        is_attachment_evidence: isAttachmentEvidenceMessage(message),
      })), now));
      const nativeWhatsappPhone = isStaffordWhatsApp(source, event.channel)
        ? safePhone(event.contact_phone) || extractNativeWhatsappPhone(messages)
        : null;
      const normalizedGhlPhone = isStaffordWhatsApp(source, event.channel) ? null : safePhone(event.contact_phone);
      const verifiedMessengerPhone = recentPhone && (!normalizedGhlPhone || recentPhone === normalizedGhlPhone) ? recentPhone : null;
      const eligiblePhone = isStaffordWhatsApp(source, event.channel) ? recentPhone || nativeWhatsappPhone || '' : verifiedMessengerPhone || '';
      const previousSnapshot = conversation.qualification_snapshot ?? {};
      const normalized = normalizeCollectorInput({
        source,
        channel: event.channel,
        real_name: clean(previousSnapshot.real_name) || undefined,
        contact_name: displayName,
        message: transcript,
        chat_history_log: transcript,
        phone: eligiblePhone,
        vehicle_type: clean(previousSnapshot.vehicle_type),
        down_payment: clean(previousSnapshot.down_payment),
        purchase_timeline: clean(previousSnapshot.purchase_timeline),
        documents: clean(previousSnapshot.documents),
        identification: clean(previousSnapshot.identification),
        bank_account: clean(previousSnapshot.bank_account),
        qualification_memory: clean(previousSnapshot.qualification_memory),
        customer_location: clean(previousSnapshot.customer_location),
        previous_predicted_bot_question: clean((conversation.qualification_snapshot?.qualification_progress as { predicted_bot_question?: unknown } | undefined)?.predicted_bot_question),
      });
      // Messenger may deliver a follow-up under a new native conversation id
      // without repeating the phone. Keep the contact-level canonical phone
      // instead of rebuilding this conversation with an empty phone.
      const effectivePhone = eligiblePhone || safePhone(lead.canonical_phone) || '';
      if (effectivePhone && effectivePhone !== lead.canonical_phone) {
        await runner.query(
          `UPDATE leads
           SET canonical_phone = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, canonical_phone, first_name, last_name`,
          [lead.id, effectivePhone],
        );
      }
      const location = await this.qualification.resolveLocation(runner, transcript);
      const language = this.sourceConfig[source].splitByLanguage ? detectLeadLanguage(transcript) : undefined;
      const additiveField = (incoming: unknown, existing: unknown): string => clean(incoming) || clean(existing);
      const contactRealName = normalizeRealName(displayName);
      const transcriptRealName = event.channel.toLowerCase() === 'whatsapp'
        ? transcript
          .split(/\n+/)
          .map((line) => normalizeRealName(line))
          .find((candidate) => Boolean(candidate)
            && candidate !== contactRealName
            && candidate.split(/\s+/).length <= 3
            && !/\b(?:para|hacer|uber|precio|hailander|civic|estoy|financiar|financiado|informaci[oó]n|gracias|semana|virginia|baltimore|ubicaci[oó]n)\b/i.test(candidate)) || ''
        : '';
      // A valid contact name is stronger evidence than a coincidental
      // single-word extraction from a later message (for example "Sorry").
      // Preserve the first meaningful name; later cycles may add fields but
      // must not replace it with conversational text.
      const realName = additiveField(transcriptRealName, previousSnapshot.real_name)
        || contactRealName
        || clean(normalized.real_name)
        || '';
      const vehicleType = additiveField(normalized.vehicle_type, previousSnapshot.vehicle_type);
      const downPayment = normalizeDownPayment(additiveField(normalized.down_payment, previousSnapshot.down_payment));
      const purchaseTimeline = additiveField(normalized.purchase_timeline, previousSnapshot.purchase_timeline);
      const documents = additiveField(normalized.documents, previousSnapshot.documents);
      const identification = additiveField(normalized.identification, previousSnapshot.identification);
      const bankAccount = additiveField(normalized.bank_account, previousSnapshot.bank_account);
      const qualificationMemory = additiveField(normalized.qualification_memory, previousSnapshot.qualification_memory);
      const vehicleYear = typeof normalized.vehicle_year === 'number'
        ? normalized.vehicle_year
        : typeof previousSnapshot.vehicle_year === 'number' ? previousSnapshot.vehicle_year : null;
      const previousFinancing = normalized.previous_financing
        || (previousSnapshot.previous_financing === 'yes' || previousSnapshot.previous_financing === 'no' ? previousSnapshot.previous_financing : '');
      const downPaymentRule = evaluateDownPayment(vehicleType, downPayment);
      const snapshot: ConversationSnapshot = {
        real_name: realName,
        phone: effectivePhone || '',
        vehicle_type: vehicleType,
        vehicle_year: vehicleYear,
        customer_location: additiveField(normalized.customer_location, previousSnapshot.customer_location),
        vehicle_category: downPaymentRule.category,
        required_down_payment: downPaymentRule.minimum,
        down_payment_amount: downPaymentRule.amount,
        down_payment_sufficient: downPaymentRule.meetsMinimum,
        down_payment: downPayment,
        previous_financing: previousFinancing,
        purchase_timeline: purchaseTimeline,
        documents,
        identification,
        bank_account: bankAccount,
        qualification_memory: qualificationMemory,
        qualification_complete: isQualificationComplete({
          real_name: realName,
          phone: effectivePhone,
          vehicle_type: vehicleType,
          down_payment: downPayment,
          purchase_timeline: purchaseTimeline,
          has_identification: identification,
          has_income_proof: documents,
          bank_account: bankAccount,
        }),
        missing_qualification: [
          !realName ? 'real_name' : '',
          !effectivePhone ? 'phone' : '',
          !vehicleType || isAdvisorHandoffVehicle(vehicleType) ? 'vehicle_type' : '',
        ].filter(Boolean),
        message_count: messages.length,
        language,
        qualification_progress: normalized.qualification_progress,
      };
      const assignedDealerId = clean(conversation.qualification_snapshot?.assigned_dealer_id);
      const resolvedDealer = sourceDealer ?? await this.qualification.findSourceDealer(runner, locationId, source, language, assignedDealerId || undefined);
      snapshot.assigned_dealer_id = resolvedDealer.id;
      const existingLeadReengagement = snapshot.phone
        ? await this.qualification.findExistingLeadReengagement(
          runner,
          snapshot.phone,
          resolvedDealer.id,
          conversation.id,
          conversation.created_at || occurredAt,
          occurredAt,
          locationId,
        )
        : null;
      if (existingLeadReengagement) {
        if (existingLeadReengagement.id !== lead.id) {
          await this.qualification.reassignConversationToLead(runner, conversation.id, lead.id, existingLeadReengagement.id);
        }
        lead = existingLeadReengagement;
        const storedLeadName = [existingLeadReengagement.first_name, existingLeadReengagement.last_name].filter(Boolean).join(' ').trim();
        if (storedLeadName) snapshot.real_name = storedLeadName;
        await this.qualification.syncLeadDealer(runner, resolvedDealer, lead.id, snapshot, location, source, true);
        await runner.query(
          `UPDATE conversations
           SET status = 'queued', qualification_snapshot = $2::jsonb, location_snapshot = $3::jsonb,
               last_message_at = GREATEST(COALESCE(last_message_at, $4::timestamptz), $4::timestamptz),
               next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [conversation.id, JSON.stringify(snapshot), JSON.stringify(location), occurredAt],
        );
        queuedPauseEvent = await this.queueService.createQueuedPauseEvent(runner, conversation.status, 'queued', {
          conversationId: conversation.id,
          ghlConversationId: event.ghl_conversation_id,
          contactId: event.ghl_contact_id,
          locationId,
          leadId: lead.id,
          source,
          emittedAt: now,
          force: true,
        });
        await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL WHERE event_id = $1`, [event.event_id]);
        await runner.commitTransaction();
        if (queuedPauseEvent) await this.queueService.dispatchQueuedPauseEvent(queuedPauseEvent);
        return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'processed' };
      }
      const stalePhone = snapshot.phone ? await this.qualification.findStalePhoneReentry(runner, snapshot.phone, resolvedDealer.id, now) : null;
      if (stalePhone) {
        await runner.query(
          `UPDATE conversations
           SET status = 'stale_phone_ignored', qualification_snapshot = $2::jsonb,
               location_snapshot = $3::jsonb, last_message_at = GREATEST(COALESCE(last_message_at, $4::timestamptz), $4::timestamptz),
               next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [conversation.id, JSON.stringify(snapshot), JSON.stringify(location), occurredAt],
        );
        await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = $2 WHERE event_id = $1`, [event.event_id, `STALE_PHONE_REENTRY:${stalePhone.sent_at}`]);
        await runner.commitTransaction();
        return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'stale_phone_ignored' };
      }
      if (normalized.real_name) {
        const { firstName: normalizedFirstName, lastName: normalizedLastName } = splitName(normalized.real_name);
        await runner.query(`UPDATE leads SET first_name = $2, last_name = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [lead.id, normalizedFirstName, normalizedLastName]);
      }
      const queuedDuplicate = await findQueuedConversationDuplicate(runner, resolvedDealer.id, snapshot.real_name || normalizedName, snapshot.phone);
      if (queuedDuplicate) {
        const isSameQueuedConversation = conversation.isExisting && queuedDuplicate.conversation_id === conversation.id;
        if (isSameQueuedConversation) await this.qualification.syncLeadDealer(runner, resolvedDealer, lead.id, snapshot, location, source);
        await runner.query(
        `UPDATE conversations
         SET status = $2::varchar, qualification_snapshot = $3::jsonb, location_snapshot = $4::jsonb,
             last_message_at = GREATEST(COALESCE(last_message_at, $5::timestamptz), $5::timestamptz), next_attempt_at = NULL,
             waiting_window_attempts = 0, waiting_window_started_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [conversation.id, isSameQueuedConversation ? 'queued' : 'duplicate_ignored', JSON.stringify(snapshot), JSON.stringify(location), occurredAt],
        );
        await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL WHERE event_id = $1`, [event.event_id]);
        await runner.commitTransaction();
        return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'processed' };
      }
      const status = this.qualification.statusForConversation(snapshot, location, resolvedDealer, source, now, 'capture');
      const enteringWaitingWindow = status.status === 'waiting_window' && conversation.status !== 'waiting_window';
      const persistedNextAttemptAt = status.status === 'waiting_window'
        ? enteringWaitingWindow
          ? new Date(now.getTime() + WAITING_WINDOW_RETRY_INTERVAL_MS).toISOString()
          : conversation.next_attempt_at ?? status.nextAttemptAt ?? new Date(now.getTime() + WAITING_WINDOW_RETRY_INTERVAL_MS).toISOString()
        : status.nextAttemptAt;
      await runner.query(
        `UPDATE conversations
         SET status = $2::varchar, qualification_snapshot = $3::jsonb, location_snapshot = $4::jsonb,
             last_message_at = GREATEST(COALESCE(last_message_at, $5::timestamptz), $5::timestamptz), ready_at = CASE WHEN $2::varchar IN ('ready', 'waiting_window', 'queued') THEN COALESCE(ready_at, $7::timestamptz) ELSE ready_at END,
             next_attempt_at = $6, waiting_window_attempts = CASE WHEN $2::varchar = 'waiting_window' THEN CASE WHEN $8::boolean THEN 0 ELSE COALESCE(waiting_window_attempts, 0) END ELSE 0 END,
             waiting_window_started_at = CASE WHEN $2::varchar = 'waiting_window' THEN COALESCE(waiting_window_started_at, $7::timestamptz) ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [conversation.id, status.status, JSON.stringify(snapshot), JSON.stringify(location), occurredAt, persistedNextAttemptAt, now.toISOString(), enteringWaitingWindow],
      );
      if (status.status === 'ready') {
        await this.qualification.syncLeadDealer(runner, resolvedDealer, lead.id, snapshot, location, source);
        await runner.query(`UPDATE conversations SET status = 'queued', dispatched_at = NULL, next_attempt_at = NULL, waiting_window_attempts = 0, waiting_window_started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [conversation.id]);
        queuedPauseEvent = await this.queueService.createQueuedPauseEvent(runner, conversation.status, 'queued', {
          conversationId: conversation.id,
          ghlConversationId: event.ghl_conversation_id,
          contactId: event.ghl_contact_id,
          locationId,
          leadId: lead.id,
          source,
          emittedAt: now,
        });
      }
      await runner.query(`UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_code = NULL WHERE event_id = $1`, [event.event_id]);
      await runner.commitTransaction();
      if (queuedPauseEvent) await this.queueService.dispatchQueuedPauseEvent(queuedPauseEvent);
      return { accepted: true, eventId: event.event_id, conversationId: conversation.id, source, status: 'processed' };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await this.recordFailedEvent(event, rawBody, source, error);
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async persistAttachments(
    runner: QueryRunner,
    conversationId: string,
    conversationMessageId: string | undefined,
    event: PersistedWebhookEvent,
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
          event.ghl_location_id || this.sourceConfig[source].locationId,
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

  private async recordFailedEvent(event: PersistedWebhookEvent, rawBody: string, source: SourceKey, error: unknown): Promise<void> {
    if (!this.dataSource) return;
    try {
      await this.dataSource.query(
        `INSERT INTO webhook_events (event_id, event_type, ghl_location_id, status, error_code, payload_hash, raw_transcript, capture_contract, capture_schema_version)
         VALUES ($1, $2, $3, 'failed', $4, $5, $6, '{}'::jsonb, 'dealeradmin.conversation.v1')
         ON CONFLICT (event_id) DO UPDATE SET status = 'failed', error_code = EXCLUDED.error_code, payload_hash = EXCLUDED.payload_hash`,
        [event.event_id, event.event_type, event.ghl_location_id || this.sourceConfig[source].locationId, error instanceof Error ? error.message.slice(0, 250) : 'UNKNOWN_ERROR', hash(rawBody), event.message_body ?? ''],
      );
    } catch {
      // Never hide the original webhook error behind audit logging.
    }
  }
}
