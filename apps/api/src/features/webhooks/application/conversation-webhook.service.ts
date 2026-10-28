import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { GhlCustomerRepliedSchema } from '@dealeradmin/contracts';
import type { DataSource, QueryRunner } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { GeoroutingService } from '../../routing/domain/services/georouting.service';
import { recordTestConversationEvent } from './test-conversation-store';
import { QUEUED_PAUSE_NOTIFIER } from '../presentation/queued-pause.tokens';
import { type QueuedPauseNotifier } from './conversation-bot-pause';
import { ConversationQueueService, type QueuedPauseDispatch } from './functions/conversations/conversation-queue.service';
import { ConversationDueFunctions } from './functions/conversations/conversation-due.functions';
import { ConversationEventFunctions } from './functions/conversations/conversation-event.functions';
import { ConversationQualificationFunctions } from './functions/conversations/conversation-qualification.functions';
import { ConversationReconciliationFunctions } from './functions/conversations/conversation-reconciliation.functions';
import { InvalidPhoneNumber, UnresolvedLocationException } from './functions/conversations/conversation-webhook.errors';
import { DUE_CONVERSATION_POLL_MS, GHL_SOURCE_CONFIG } from './functions/conversations/conversation-webhook.config';
import { currentLocalNow, hash, inputIndicatesWhatsApp, normalizedChannel, safePhone, sourceKey } from './functions/conversations/conversation-webhook.helpers';
import { WebhookProcessingAuditService } from './webhook-processing-audit.service';
import { GhlGuardService } from './ghl-guard.service';
import type {
  ConversationSnapshot,
  ConversationWebhookResponse,
  DealerRow,
  DueConversationResponse,
  DueConversationHealth,
  LocationSnapshot,
  MediaReconciliationResponse,
  SourceKey,
} from './functions/conversations/conversation-webhook.types';
import type { CollectorLanguage } from '../../leads/domain/collector-normalizer';

export * from './functions/conversations/conversation-webhook.config';
export type * from './functions/conversations/conversation-webhook.types';

@Injectable()
export class ConversationWebhookService implements OnModuleInit, OnModuleDestroy {
  private duePollTimer?: ReturnType<typeof setInterval>;
  private duePollInFlight = false;
  private readonly queueService: ConversationQueueService;
  private readonly qualification: ConversationQualificationFunctions;
  private readonly eventFunctions: ConversationEventFunctions;
  private readonly reconciliation: ConversationReconciliationFunctions;
  private readonly guard: GhlGuardService;
  private readonly dueFunctions: ConversationDueFunctions;

  constructor(
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
    @Optional() @Inject(GeoroutingService) georoutingService?: GeoroutingService,
    @Optional() @Inject(QUEUED_PAUSE_NOTIFIER) queuedPauseNotifier?: QueuedPauseNotifier,
    @Optional() private readonly processingAudit?: WebhookProcessingAuditService,
  ) {
    this.queueService = new ConversationQueueService(dataSource, queuedPauseNotifier, GHL_SOURCE_CONFIG);
    this.qualification = new ConversationQualificationFunctions(georoutingService, GHL_SOURCE_CONFIG);
    this.eventFunctions = new ConversationEventFunctions(dataSource, this.qualification, this.queueService, GHL_SOURCE_CONFIG);
    this.reconciliation = new ConversationReconciliationFunctions(dataSource, this.qualification, this.queueService, GHL_SOURCE_CONFIG);
    this.guard = new GhlGuardService(dataSource, this.reconciliation, GHL_SOURCE_CONFIG);
    this.dueFunctions = new ConversationDueFunctions(dataSource, this.qualification, this.queueService, this.reconciliation, GHL_SOURCE_CONFIG, this.guard);
  }

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

  async queueLeadForBotSilence(leadId: string, emittedAt = new Date()): Promise<{ queued: boolean; eventId?: string }> {
    return this.queueService.queueLeadForBotSilence(leadId, emittedAt);
  }

  async reconcileMediaConversation(id: string, now = currentLocalNow()): Promise<MediaReconciliationResponse> {
    return this.reconciliation.reconcileMediaConversation(id, now);
  }

  async acceptCustomerReplied(
    input: unknown,
    sourceValue: string,
    headers: { contactId?: string; conversationId?: string; messageId?: string; requestId?: string; testNow?: Date },
    rawBody?: string,
  ): Promise<ConversationWebhookResponse> {
    try {
      const source = sourceKey(sourceValue, GHL_SOURCE_CONFIG);
      return await this.processCustomerReplied(input, source, headers, rawBody);
    } catch (error) {
      if (this.processingAudit) {
        const errorName = error instanceof Error && error.name ? error.name : 'UNKNOWN_ERROR';
        await this.processingAudit.recordFromPayload({
          requestId: headers.requestId,
          source: sourceValue,
          status: error instanceof UnresolvedLocationException ? 'pending_classification' : errorName === 'InvalidPhoneNumber' ? 'InvalidPhoneNumber' : 'failed',
          errorCode: errorName,
          body: input,
          headers,
          metadata: {
            exception: errorName,
            ...(error instanceof UnresolvedLocationException ? { fallback_status: 'Pendiente de Clasificación' } : {}),
          },
        });
      }
      throw error;
    }
  }

  private async processCustomerReplied(
    input: unknown,
    source: SourceKey,
    headers: { contactId?: string; conversationId?: string; messageId?: string; requestId?: string; testNow?: Date },
    rawBody?: string,
  ): Promise<ConversationWebhookResponse> {
    const sourceConfig = GHL_SOURCE_CONFIG[source];
    const body = this.eventFunctions.normalizeInput(input, sourceConfig.defaultChannel, headers);
    const parsed = GhlCustomerRepliedSchema.safeParse(body);
    if (!parsed.success) throw new UnprocessableEntityException({ code: 'INVALID_CUSTOMER_REPLIED_PAYLOAD', issues: parsed.error.issues });

    const event = { ...parsed.data, channel: normalizedChannel(parsed.data.channel) || parsed.data.channel };
    if (event.contact_phone && !safePhone(event.contact_phone)) throw new InvalidPhoneNumber(event.contact_phone);
    const contactId = event.ghl_contact_id;
    const raw = rawBody || JSON.stringify(input);
    const eventId = event.event_id || `ghl:${source}:${hash(raw)}`;
    if (source === 'fredericksburg-2' && inputIndicatesWhatsApp(input, event.channel)) {
      return {
        accepted: true,
        eventId,
        conversationId: event.ghl_conversation_id || `contact:${contactId}:whatsapp`,
        source,
        status: 'ignored_channel',
      };
    }
    if (sourceConfig.supportedChannels && !sourceConfig.supportedChannels.includes(event.channel as 'whatsapp' | 'messenger')) {
      return {
        accepted: true,
        eventId,
        conversationId: event.ghl_conversation_id || `contact:${contactId}:${event.channel}`,
        source,
        status: 'ignored_channel',
      };
    }
    const message = String(event.message_body ?? '').trim();
    if (!contactId) throw new UnprocessableEntityException('El webhook requiere el Contact ID nativo de GHL');
    if (!message && (!event.message_attachments || event.message_attachments.length === 0)) {
      throw new UnprocessableEntityException('El webhook requiere el cuerpo del mensaje o al menos un attachment');
    }

    const nativeConversationId = event.ghl_conversation_id?.trim() || null;
    const conversationId = nativeConversationId || `contact:${contactId}:${event.channel}`;
    const locationId = event.ghl_location_id || sourceConfig.locationId;
    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      recordTestConversationEvent({ eventId, source, contactId, conversationId, message, channel: event.channel, attachments: event.message_attachments });
      return { accepted: true, eventId, conversationId, source, status: 'processed' };
    }
    if (!this.dataSource) throw new ServiceUnavailableException('Database connection is not available');
    const response = await this.eventFunctions.persistEvent({
      ...event,
      ghl_location_id: locationId,
      ghl_contact_id: contactId,
      ghl_conversation_id: conversationId,
      event_id: eventId,
    }, source, raw, headers.testNow);
    await this.triggerTargetedGuardIfSplit(locationId, contactId, event.channel, headers.testNow, message, conversationId);
    return response;
  }

  /**
   * If the contact has a sibling native conversation, ask the guard to
   * reconcile only this contact. This also covers GHL creating a second native
   * conversation for the same contact, which is common when a Messenger
   * campaign changes language. The phone-shaped fallback remains for synthetic
   * conversations that do not have a sibling yet.
   */
  private async triggerTargetedGuardIfSplit(locationId: string, contactId: string, channel: string, now?: Date, message = '', currentConversationId?: string): Promise<void> {
    try {
      const split = await this.dataSource!.query(
        `SELECT 1
         FROM conversations
         WHERE ghl_location_id = $1
           AND ghl_contact_id = $2
           AND channel = $3
           AND EXISTS (
             SELECT 1
             FROM conversations current_conversation
             WHERE current_conversation.ghl_location_id = $1
               AND current_conversation.ghl_contact_id = $2
               AND current_conversation.channel = $3
               AND current_conversation.ghl_conversation_id = $4
           )
           AND ghl_conversation_id IS NOT NULL
           AND ghl_conversation_id NOT LIKE 'contact:%'
           AND ghl_conversation_id <> $4
         LIMIT 1`,
        [locationId, contactId, channel, currentConversationId || `contact:${contactId}:${channel}`],
      ) as Array<Record<string, unknown>>;
      // A malformed phone can be the first webhook delivered while the valid
      // follow-up is already visible in GHL. In that case there is no native
      // sibling yet, so the old split-only probe never ran and the scheduled
      // batch could leave the contact unrecovered for several cycles.
      const digitCount = (message.match(/\d/g) ?? []).length;
      if (!split[0] && digitCount < 7) return;
      void this.guard.run(now || new Date(), { contactIds: [contactId] }).catch(() => {
        // The scheduled guard remains the fallback for a transient targeted-run failure.
      });
    } catch {
      // A guard probe must never turn a successfully persisted webhook into a 5xx.
    }
  }

  async processDueConversations(now = currentLocalNow(), options: { reconcileActive?: boolean; runGuard?: boolean; guardContactIds?: string[]; forceGuard?: boolean; dueContactIds?: string[]; recentOnly?: boolean } = {}): Promise<DueConversationResponse> {
    return this.dueFunctions.processDueConversations(now, options);
  }

  async getDueConversationHealth(options: { recentOnly?: boolean; now?: Date } = {}): Promise<DueConversationHealth> {
    return this.dueFunctions.getDueConversationHealth(options);
  }

  async runGhlGuard(now = currentLocalNow(), options: { contactIds?: string[]; force?: boolean; queuedOnly?: boolean; recentOnly?: boolean } = {}) {
    return this.guard.run(now, options);
  }

  async replayFailedIngress(options: { since?: Date; limit?: number } = {}) {
    if (!this.dataSource) throw new ServiceUnavailableException('Database connection is not available');

    const sources = Object.keys(GHL_SOURCE_CONFIG);
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 250), 1), 500);
    const rows = await this.dataSource.query(
      `SELECT request_id, source, ghl_contact_id, ghl_conversation_id, raw_body, payload
       FROM webhook_ingress_logs
       WHERE path LIKE '%/ghl/customer-replied/%'
         AND source = ANY($1::text[])
         AND payload IS NOT NULL
         AND (
           outcome = 'failed'
           OR (
             outcome = 'accepted'
             AND event_id IS NULL
             AND (
               NULLIF(payload->>'message_body', '') IS NOT NULL
               OR NULLIF(payload->>'messageBody', '') IS NOT NULL
               OR NULLIF(payload->'customData'->>'message_body', '') IS NOT NULL
               OR NULLIF(payload->'customData'->>'messageBody', '') IS NOT NULL
               OR (jsonb_typeof(payload->'message') = 'object' AND NULLIF(payload->'message'->>'body', '') IS NOT NULL)
               OR (jsonb_typeof(payload->'message') = 'object' AND NULLIF(payload->'message'->>'text', '') IS NOT NULL)
             )
           )
         )
         AND ($2::timestamptz IS NULL OR received_at >= $2::timestamptz)
       ORDER BY received_at ASC
       LIMIT $3`,
      [sources, options.since?.toISOString() ?? null, limit],
    ) as Array<{
      request_id: string;
      source: string;
      ghl_contact_id: string | null;
      ghl_conversation_id: string | null;
      raw_body: string | null;
      payload: unknown;
    }>;

    const summary = {
      selected: rows.length,
      processed: 0,
      duplicateIgnored: 0,
      ignoredChannel: 0,
      failed: 0,
      results: [] as Array<{ requestId: string; status: string; eventId?: string; error?: string }>,
    };

    for (const row of rows) {
      const body = row.payload ?? (() => {
        try { return JSON.parse(row.raw_body ?? '{}'); } catch { return {}; }
      })();
      const payload = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const text = (value: unknown): string | undefined => {
        const normalized = value === undefined || value === null ? '' : String(value).trim();
        return normalized || undefined;
      };
      const contact = payload.contact && typeof payload.contact === 'object' ? payload.contact as Record<string, unknown> : {};
      const conversation = payload.conversation && typeof payload.conversation === 'object' ? payload.conversation as Record<string, unknown> : {};
      const messageId = text(payload.ghl_message_id ?? payload.message_id ?? payload.messageId);
      const contactId = row.ghl_contact_id || text(payload.ghl_contact_id ?? payload.contact_id ?? contact.id);
      const conversationId = row.ghl_conversation_id || text(payload.ghl_conversation_id ?? payload.conversation_id ?? conversation.id);

      try {
        const response = await this.acceptCustomerReplied(
          body,
          row.source,
          { contactId: contactId ?? undefined, conversationId: conversationId ?? undefined, messageId, requestId: row.request_id },
          row.raw_body ?? JSON.stringify(body),
        );
        await this.processingAudit?.recordFromPayload({
          requestId: row.request_id,
          source: row.source,
          eventId: response.eventId,
          status: response.status,
          body,
          headers: { contactId: contactId ?? undefined, conversationId: conversationId ?? undefined, messageId },
          metadata: { telemetry_version: 'webhook-processing.v1', replay: true },
        });
        await this.dataSource.query(
          `UPDATE webhook_ingress_logs
           SET status_code = 200,
               outcome = 'accepted',
               event_id = COALESCE(event_id, $2),
               error_code = CASE WHEN $3 = 'ignored_channel' THEN 'ignored_channel' ELSE NULL END,
               completed_at = CURRENT_TIMESTAMP,
               duration_ms = FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - received_at)) * 1000)::integer
           WHERE request_id = $1 AND (outcome = 'failed' OR (outcome = 'accepted' AND event_id IS NULL))`,
          [row.request_id, response.eventId, response.status],
        );
        summary.processed += 1;
        if (response.status === 'duplicate_ignored') summary.duplicateIgnored += 1;
        if (response.status === 'ignored_channel') summary.ignoredChannel += 1;
        summary.results.push({ requestId: row.request_id, status: response.status, eventId: response.eventId });
      } catch (error) {
        summary.failed += 1;
        summary.results.push({
          requestId: row.request_id,
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        });
      }
    }

    return { accepted: summary.failed === 0, ...summary };
  }

  async releaseDueConversation(id: string, now = currentLocalNow()): Promise<boolean> {
    return (this.dueFunctions as unknown as { releaseDueConversation: (conversationId: string, emittedAt: Date) => Promise<boolean> }).releaseDueConversation(id, now);
  }

  async dispatchPendingQueuedPauseEvents(): Promise<number> {
    return this.queueService.dispatchPendingQueuedPauseEvents();
  }

  private async pollDueConversations(): Promise<void> {
    if (this.duePollInFlight) return;
    this.duePollInFlight = true;
    try {
      // The five-minute waiting-window release must stay independent from
      // both the global GHL Guard lease and active reconciliation. The
      // reconciliation pass can perform slow GHL reads for a partial contact;
      // keeping it inside this in-flight flag would make the 30-second poll
      // skip later due windows until that unrelated work finishes. The
      // scheduled workflow owns reconciliation and the separate queued backup
      // pass, so this poll only advances the durable waiting-window clock.
      await this.processDueConversations(undefined, { reconcileActive: false, runGuard: false, recentOnly: true });
    } catch {
      // Polling is best effort; the next cycle retries the pending work.
    } finally {
      this.duePollInFlight = false;
    }
  }

  // Compatibility facades keep focused unit tests and diagnostic callers stable
  // while the implementations live in dedicated modules.
  statusForConversation(
    snapshot: ConversationSnapshot,
    location: LocationSnapshot,
    dealer: DealerRow,
    source: SourceKey,
    now: Date,
    phase: 'capture' | 'due',
    readyAt?: string | null,
    waitingWindowAttempts?: number | string | null,
  ) {
    return this.qualification.statusForConversation(snapshot, location, dealer, source, now, phase, readyAt, waitingWindowAttempts);
  }

  async findSourceDealer(runner: QueryRunner, locationId: string, source?: SourceKey, language?: CollectorLanguage, assignedDealerId?: string) {
    return this.qualification.findSourceDealer(runner, locationId, source, language, assignedDealerId);
  }

  async syncLeadDealer(runner: QueryRunner, sourceDealer: DealerRow, leadId: string, snapshot: ConversationSnapshot, location: LocationSnapshot, source: SourceKey, reengagement = false): Promise<void> {
    return this.qualification.syncLeadDealer(runner, sourceDealer, leadId, snapshot, location, source, reengagement);
  }

  async findStalePhoneReentry(runner: QueryRunner, phone: string, dealerId: string, now: Date): Promise<{ sent_at: string } | null> {
    return this.qualification.findStalePhoneReentry(runner, phone, dealerId, now);
  }

  async createQueuedPauseEvent(
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
    return this.queueService.createQueuedPauseEvent(runner, previousStatus, nextStatus, input);
  }
}
