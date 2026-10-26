import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { detectLeadLanguage, extractRecentMessagePhone, isAdvisorHandoffVehicle, isQualificationComplete, isStaffordWhatsAppVehicleLabel, normalizeCollectorInput, normalizeRealName } from '../../../../leads/domain/collector-normalizer';
import { evaluateDownPayment, normalizeDownPayment } from '../../../../leads/domain/down-payment';
import { findQueuedConversationDuplicate } from '../../../../leads/domain/lead-duplicate';
import { ConversationQueueService, type QueuedPauseDispatch } from './conversation-queue.service';
import { ConversationQualificationFunctions } from './conversation-qualification.functions';
import { ACTIVE_RECONCILIATION_BATCH_SIZE, GHL_SOURCE_CONFIG, RECONCILIATION_LOCATION_IDS, CONVERSATION_STABILIZATION_MS, WAITING_WINDOW_MAX_ATTEMPTS, WAITING_WINDOW_RETRY_INTERVAL_MS } from './conversation-webhook.config';
import { addProcessedImageEvidence, clean, extractNativeWhatsappPhone, inputIndicatesWhatsApp, isAttachmentEvidenceMessage, safePhone, splitName } from './conversation-webhook.helpers';
import type { ConversationMessageRow, ConversationSnapshot, LocationSnapshot, MediaReconciliationResponse, SourceConfigMap, SourceKey } from './conversation-webhook.types';
import { configureWebhookTransactionSafety } from '../../transaction-safety';
import { isEmptyMarker } from '../../../../leads/domain/collector-normalizer/text-cleaner';

const DOWN_PAYMENT_PROMPT = /\b(?:down|payment|enganche|pago\s+inicial|pago\s+de\s+entrada|inicial)\b/i;
const DOWN_PAYMENT_QUESTION = /\b(?:cu[aá]nto|con\s+cu[aá]nto|how\s+much|approximately|aproximadamente|disponible|available|contar[ií]as|tendr[ií]as)\b/i;

function isDownPaymentPrompt(value: unknown): boolean {
  const prompt = clean(value);
  return Boolean(prompt && DOWN_PAYMENT_PROMPT.test(prompt) && DOWN_PAYMENT_QUESTION.test(prompt));
}

export class ConversationReconciliationFunctions {
  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly qualification: ConversationQualificationFunctions,
    private readonly queueService: ConversationQueueService,
    private readonly sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
  ) {}

  async reconcileMediaConversation(id: string, now: Date): Promise<MediaReconciliationResponse> {
    if (!this.dataSource) throw new ServiceUnavailableException('Base de datos no disponible');
    await this.reconcileConversation(id, now, true);
    const rows = await this.dataSource.query(
      `SELECT status, qualification_snapshot FROM conversations WHERE id = $1`,
      [id],
    ) as Array<{ status: string; qualification_snapshot: ConversationSnapshot | null }>;
    if (!rows[0]) throw new BadRequestException('Conversación no encontrada');
    return { accepted: true, conversationId: id, status: rows[0].status, qualificationSnapshot: rows[0].qualification_snapshot };
  }

  async reconcileActiveConversations(now: Date): Promise<void> {
    if (!this.dataSource) return;
    const rows = await this.dataSource.query(
      `SELECT id
       FROM conversations
       WHERE status IN ('partial', 'waiting_window', 'stale_phone_ignored')
          OR (
            status <> 'queued'
            AND (
              ghl_location_id = ANY($2::text[])
              AND NOT EXISTS (SELECT 1 FROM lead_dealers orphan_ld WHERE orphan_ld.lead_id = conversations.lead_id)
            )
          )
       ORDER BY updated_at DESC
       LIMIT $1`,
      [ACTIVE_RECONCILIATION_BATCH_SIZE, RECONCILIATION_LOCATION_IDS],
    ) as Array<{ id: string }>;
    for (const row of rows) await this.reconcileConversation(row.id, now);
  }

  async reconcileConversation(id: string, now: Date, propagateErrors = false, additiveOnly = false, targeted = false, countWaitingWindowAttempt = false): Promise<void> {
    const runner = this.dataSource!.createQueryRunner();
    let queuedPauseEvent: QueuedPauseDispatch | null = null;
    await runner.connect();
    await runner.startTransaction();
    try {
      await configureWebhookTransactionSafety(runner);
      const rows = await runner.query(
        `SELECT c.id, c.channel, c.ghl_location_id, c.ghl_contact_id, c.ghl_conversation_id, c.status,
        c.qualification_snapshot, c.location_snapshot, c.ready_at, c.next_attempt_at, c.last_message_at,
        c.waiting_window_attempts, c.waiting_window_started_at,
                l.id AS lead_id, l.canonical_phone, l.first_name, l.last_name
         FROM conversations c
         JOIN leads l ON l.id = c.lead_id
         WHERE c.id = $1 AND (c.status IN ('partial', 'waiting_window', 'stale_phone_ignored')
           OR ($3::boolean AND c.status IN ('queued', 'duplicate_ignored'))
           OR (c.status <> 'queued' AND c.ghl_location_id = ANY($2::text[])
               AND NOT EXISTS (SELECT 1 FROM lead_dealers orphan_ld WHERE orphan_ld.lead_id = c.lead_id)))
         FOR UPDATE`,
        [id, RECONCILIATION_LOCATION_IDS, targeted],
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
        next_attempt_at: string | null;
        last_message_at: string | null;
        waiting_window_attempts: number | string | null;
        waiting_window_started_at: string | null;
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
      const configured = Object.entries(this.sourceConfig).find(([, config]) => config.locationId === row.ghl_location_id);
      if (!configured) {
        await runner.rollbackTransaction();
        return;
      }
      const source = configured[0] as SourceKey;
      const current = row.qualification_snapshot ?? {} as ConversationSnapshot;
      // GHL can create more than one native conversation for the same contact
      // (for example when an Action campaign changes language). Qualification
      // evidence belongs to the contact/location/channel, not to whichever
      // native id happened to receive the latest message.
      const messages = await runner.query(
        `SELECT cm.body, cm.direction, cm.occurred_at, cm.raw_payload,
                ca.extracted_text AS attachment_extracted_text
         FROM conversation_messages cm
         INNER JOIN conversations sibling
           ON sibling.id = cm.conversation_id
         LEFT JOIN conversation_attachments ca
           ON ca.conversation_message_id = cm.id
          AND ca.processing_status = 'done'
          AND ca.media_kind = 'image'
          AND ca.extracted_text IS NOT NULL
         WHERE sibling.ghl_location_id = $1
           AND sibling.ghl_contact_id = $2
           AND sibling.channel = $3
         ORDER BY cm.occurred_at ASC, cm.created_at ASC`,
        [row.ghl_location_id, row.ghl_contact_id, row.channel],
      ) as ConversationMessageRow[];
      if (source === 'fredericksburg-2' && messages.some((message) => inputIndicatesWhatsApp(message.raw_payload, row.channel))) {
        await runner.query(`UPDATE conversations SET status = 'ignored_channel', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        await runner.commitTransaction();
        return;
      }
      const evidenceMessages = addProcessedImageEvidence(messages);
      let previousOutbound = '';
      const transcriptLines: string[] = [];
      for (const item of evidenceMessages) {
        if (item.direction === 'outbound') {
          previousOutbound = clean(item.body);
          continue;
        }
        const body = clean(item.body);
        if (!body) continue;
        // Keep only a typed context marker instead of the outbound text. This
        // lets an answer such as "Quizás 1500" be understood as down payment
        // without allowing the dealer's suggested $2000-$2500 range to become
        // the customer's amount.
        if (isDownPaymentPrompt(previousOutbound)) transcriptLines.push('__DOWN_PROMPT__');
        transcriptLines.push(body);
      }
      const transcript = transcriptLines.join('\n');
      if (!transcript) {
        await runner.rollbackTransaction();
        return;
      }
      const contactName = clean(`${row.first_name || ''} ${row.last_name || ''}`) || 'Lead';
      const recentPhone = safePhone(extractRecentMessagePhone(evidenceMessages.map((message) => ({ ...message, is_attachment_evidence: isAttachmentEvidenceMessage(message) })), now));
      const nativeWhatsappPhone = this.isStaffordWhatsApp(source, row.channel)
        ? safePhone(row.canonical_phone) || extractNativeWhatsappPhone(messages)
        : null;
      const existingPhone = safePhone(current.phone) || safePhone(row.canonical_phone);
      const candidatePhone = recentPhone || nativeWhatsappPhone || '';
      // A Messenger transcript often contains no phone because GHL already
      // provides it on the lead. Never erase that persisted phone during an
      // active reconciliation just because the latest messages omit it.
      const effectivePhone = candidatePhone || existingPhone || '';
      const normalized = normalizeCollectorInput({
        source,
        channel: row.channel,
        message: transcript,
        chat_history_log: transcript,
        phone: effectivePhone,
        // A targeted repair is an explicit transcript replay. Do not feed the
        // contaminated name/down-payment fields back into the normalizer or
        // they can win over the newer evidence in the conversation.
        real_name: targeted ? '' : clean(current.real_name),
        contact_name: contactName,
        vehicle_type: targeted ? '' : clean(current.vehicle_type),
        down_payment: targeted ? '' : clean(current.down_payment),
        purchase_timeline: targeted ? '' : clean(current.purchase_timeline),
        documents: targeted ? '' : clean(current.documents),
        identification: targeted ? '' : clean(current.identification),
        bank_account: targeted ? '' : clean(current.bank_account),
        qualification_memory: targeted ? '' : clean(current.qualification_memory),
        customer_location: clean(current.customer_location),
        previous_predicted_bot_question: clean(current.qualification_progress?.predicted_bot_question),
      });
      const preserveOrNormalize = (existing: unknown, incoming: unknown): string => {
        const existingValue = clean(existing);
        const incomingValue = clean(incoming);
        const meaningfulExisting = isEmptyMarker(existingValue) ? '' : existingValue;
        const meaningfulIncoming = isEmptyMarker(incomingValue) ? '' : incomingValue;
        return additiveOnly ? meaningfulExisting || meaningfulIncoming : meaningfulIncoming || meaningfulExisting;
      };
      // Never preserve a stale conversational reply as a real name. The
      // periodic watchdog uses a non-targeted reconciliation, so sanitize the
      // existing snapshot before applying the additive merge as well.
      const currentRealName = normalizeRealName(clean(current.real_name));
      const realName = targeted ? clean(normalized.real_name) : preserveOrNormalize(currentRealName, normalized.real_name);
      const vehicle = targeted ? clean(normalized.vehicle_type) : preserveOrNormalize(current.vehicle_type, normalized.vehicle_type);
      const vehicleYear = targeted
        ? normalized.vehicle_year
        : additiveOnly && typeof current.vehicle_year === 'number'
        ? current.vehicle_year
        : normalized.vehicle_year ?? (typeof current.vehicle_year === 'number' ? current.vehicle_year : null);
      const downPayment = normalizeDownPayment(targeted ? normalized.down_payment : preserveOrNormalize(current.down_payment, normalized.down_payment));
      const targetedOrExisting = (existing: unknown, incoming: unknown): string => {
        const incomingValue = clean(incoming);
        return targeted ? incomingValue || clean(existing) : preserveOrNormalize(existing, incomingValue);
      };
      const purchaseTimeline = targetedOrExisting(current.purchase_timeline, normalized.purchase_timeline);
      const documents = targetedOrExisting(current.documents, normalized.documents);
      const identification = targetedOrExisting(current.identification, normalized.identification);
      const bankAccount = targetedOrExisting(current.bank_account, normalized.bank_account);
      const qualificationMemory = targetedOrExisting(current.qualification_memory, normalized.qualification_memory);
      const previousFinancing = targeted
        ? normalized.previous_financing === 'yes' || normalized.previous_financing === 'no'
          ? normalized.previous_financing
          : current.previous_financing === 'yes' || current.previous_financing === 'no' ? current.previous_financing : ''
        : normalized.previous_financing || (current.previous_financing === 'yes' || current.previous_financing === 'no' ? current.previous_financing : '');
      const downPaymentRule = evaluateDownPayment(vehicle, downPayment);
      const qualificationComplete = Boolean(current.qualification_complete) || isQualificationComplete({
        real_name: realName,
        phone: effectivePhone,
        vehicle_type: vehicle,
        down_payment: downPayment,
        purchase_timeline: purchaseTimeline,
        has_identification: identification,
        has_income_proof: documents,
        bank_account: bankAccount,
      });
      const missingQualification = [!realName ? 'real_name' : '', !effectivePhone ? 'phone' : '', !vehicle || isAdvisorHandoffVehicle(vehicle) ? 'vehicle_type' : ''].filter(Boolean);
      const resolvedLocation = await this.qualification.resolveLocation(runner, transcript);
      const hasResolvedLocation = Boolean(resolvedLocation.city || resolvedLocation.state || resolvedLocation.zip_code || resolvedLocation.easterns_zone);
      const existingLocation = row.location_snapshot ?? { city: null, state: null, zip_code: null, easterns_zone: null };
      const location = additiveOnly
        ? {
          city: existingLocation.city || resolvedLocation.city || null,
          state: existingLocation.state || resolvedLocation.state || null,
          zip_code: existingLocation.zip_code || resolvedLocation.zip_code || null,
          easterns_zone: existingLocation.easterns_zone || resolvedLocation.easterns_zone || null,
        }
        : hasResolvedLocation ? resolvedLocation : existingLocation;
      const language = additiveOnly
        ? current.language || (this.sourceConfig[source].splitByLanguage ? detectLeadLanguage(transcript) : undefined)
        : this.sourceConfig[source].splitByLanguage ? detectLeadLanguage(transcript) : current.language;
      const qualificationProgress = additiveOnly
        ? { ...normalized.qualification_progress, ...current.qualification_progress }
        : normalized.qualification_progress;
      const snapshot: ConversationSnapshot = {
        real_name: realName,
        phone: effectivePhone,
        vehicle_type: vehicle,
        vehicle_year: vehicleYear,
        customer_location: preserveOrNormalize(current.customer_location, normalized.customer_location),
        vehicle_category: downPaymentRule.category,
        required_down_payment: downPaymentRule.minimum,
        down_payment_amount: downPaymentRule.amount,
        down_payment_sufficient: downPaymentRule.meetsMinimum,
        down_payment: downPayment,
        previous_financing: additiveOnly && (current.previous_financing === 'yes' || current.previous_financing === 'no')
          ? current.previous_financing
          : previousFinancing,
        purchase_timeline: purchaseTimeline,
        documents,
        identification,
        bank_account: bankAccount,
        qualification_memory: qualificationMemory,
        qualification_complete: qualificationComplete,
        missing_qualification: missingQualification,
        message_count: additiveOnly ? Math.max(Number(current.message_count || 0), messages.filter((message) => message.direction === 'inbound').length) : messages.filter((message) => message.direction === 'inbound').length,
        language,
        qualification_progress: qualificationProgress,
        assigned_dealer_id: clean(current.assigned_dealer_id) || undefined,
      };
      const dealer = await this.qualification.findSourceDealer(runner, row.ghl_location_id, source, language, clean(current.assigned_dealer_id) || undefined);
      snapshot.assigned_dealer_id = dealer.id;
      if (snapshot.real_name) {
        const { firstName, lastName } = splitName(snapshot.real_name);
        await runner.query(`UPDATE leads SET first_name = $2, last_name = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.lead_id, firstName, lastName]);
      } else if (row.channel !== 'instagram' && (isStaffordWhatsAppVehicleLabel(contactName, source, row.channel) || (contactName !== 'Lead' && !normalizeRealName(contactName)))) {
        // A Stafford WhatsApp vehicle/offer label can be stored in the lead
        // name before the transcript replay. More generally, clear only a
        // stored name that the same normalizer now identifies as a
        // qualification label or conversational reply; preserve valid names
        // when the transcript simply contains no name answer. Instagram's
        // contact label is a display name and must remain visible even when
        // it is not a name declared in the qualification transcript.
        await runner.query(`UPDATE leads SET first_name = '', last_name = '', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.lead_id]);
      }
      if (effectivePhone && effectivePhone !== row.canonical_phone) {
        await runner.query(
          `UPDATE leads SET canonical_phone = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [row.lead_id, effectivePhone],
        );
      }
      const lastMessageAt = row.last_message_at ? new Date(row.last_message_at).getTime() : Number.NaN;
      const recentlyCaptured = Number.isFinite(lastMessageAt) && now.getTime() - lastMessageAt < CONVERSATION_STABILIZATION_MS;
      const phase = row.status === 'partial' && snapshot.qualification_complete && recentlyCaptured ? 'capture' : 'due';
      const activeWindow = row.status === 'waiting_window' && row.next_attempt_at && new Date(row.next_attempt_at).getTime() > now.getTime();
      const waitingWindowGrace = row.status === 'waiting_window'
        && (activeWindow || Number(row.waiting_window_attempts ?? 0) < WAITING_WINDOW_MAX_ATTEMPTS);
      const preserveTargetedStatus = targeted && (row.status === 'queued' || row.status === 'duplicate_ignored');
      const status = preserveTargetedStatus
        ? { status: row.status as 'queued' | 'duplicate_ignored', nextAttemptAt: null }
        : waitingWindowGrace
        ? { status: 'waiting_window' as const, nextAttemptAt: row.next_attempt_at || new Date(now.getTime() + WAITING_WINDOW_RETRY_INTERVAL_MS).toISOString() }
        : this.qualification.statusForConversation(snapshot, location, dealer, source, now, phase, row.ready_at || row.last_message_at, row.waiting_window_attempts);
      const currentWaitingWindowAttempts = Number(row.waiting_window_attempts ?? 0);
      const shouldCountWaitingWindowAttempt = countWaitingWindowAttempt
        && row.status === 'waiting_window'
        && (!row.next_attempt_at || new Date(row.next_attempt_at).getTime() <= now.getTime())
        && status.status === 'waiting_window'
        && currentWaitingWindowAttempts < WAITING_WINDOW_MAX_ATTEMPTS;
      const enteringWaitingWindow = status.status === 'waiting_window' && row.status !== 'waiting_window';
      const nextAttemptAt = shouldCountWaitingWindowAttempt
        ? new Date(now.getTime() + WAITING_WINDOW_RETRY_INTERVAL_MS).toISOString()
        : status.status === 'waiting_window'
          ? enteringWaitingWindow
            ? new Date(now.getTime() + WAITING_WINDOW_RETRY_INTERVAL_MS).toISOString()
            : row.next_attempt_at ?? status.nextAttemptAt ?? new Date(now.getTime() + WAITING_WINDOW_RETRY_INTERVAL_MS).toISOString()
          : status.nextAttemptAt;
      const nextWaitingWindowAttempts = status.status === 'waiting_window'
        ? shouldCountWaitingWindowAttempt ? currentWaitingWindowAttempts + 1 : currentWaitingWindowAttempts
        : 0;
      await runner.query(
        `UPDATE conversations
         SET status = $2::varchar, qualification_snapshot = $3::jsonb, location_snapshot = $4::jsonb,
             next_attempt_at = $5,
             ready_at = CASE WHEN $2::varchar IN ('ready', 'waiting_window', 'queued') THEN COALESCE(ready_at, $6::timestamptz) ELSE ready_at END,
             waiting_window_attempts = CASE
               WHEN $2::varchar = 'waiting_window' THEN $7
               WHEN $2::varchar = 'queued' THEN waiting_window_attempts
               ELSE 0
             END,
             waiting_window_started_at = CASE
               WHEN $2::varchar = 'waiting_window' THEN COALESCE(waiting_window_started_at, $6::timestamptz)
               WHEN $2::varchar = 'queued' THEN waiting_window_started_at
               ELSE NULL
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, status.status, JSON.stringify(snapshot), JSON.stringify(location), nextAttemptAt, now.toISOString(), nextWaitingWindowAttempts],
      );
      // A targeted Guard replay can keep a queued row queued while it repairs
      // the qualification snapshot from the complete GHL history. Persist
      // the same repaired fields to lead_dealers too; otherwise the UI and
      // copy flow continue reading the stale pre-Guard values.
      if (preserveTargetedStatus) {
        await this.qualification.syncLeadDealer(runner, dealer, row.lead_id, snapshot, location, source);
      } else if (status.status === 'ready') {
        const duplicate = await findQueuedConversationDuplicate(runner, dealer.id, snapshot.real_name || contactName, snapshot.phone, id);
        if (!duplicate) {
          await this.qualification.syncLeadDealer(runner, dealer, row.lead_id, snapshot, location, source);
          await runner.query(`UPDATE conversations SET status = 'queued', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
          queuedPauseEvent = await this.queueService.createQueuedPauseEvent(runner, row.status, 'queued', {
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
      if (queuedPauseEvent) await this.queueService.dispatchQueuedPauseEvent(queuedPauseEvent);
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (propagateErrors) throw error;
    } finally {
      await runner.release();
    }
  }

  private isStaffordWhatsApp(source: SourceKey, channel: string): boolean {
    return source === 'stafford' && channel.trim().toLowerCase() === 'whatsapp';
  }
}
