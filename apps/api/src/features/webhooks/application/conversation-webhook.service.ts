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
    if (source === 'fredericksburg-2' && inputIndicatesWhatsApp(input, event.channel)) {
      return {
        accepted: true,
        eventId: event.event_id || `ghl:${source}:${hash(rawBody || JSON.stringify(input))}`,
        conversationId: event.ghl_conversation_id || `contact:${event.ghl_contact_id}:whatsapp`,
        source,
        status: 'ignored_channel',
      };
    }
    if (sourceConfig.supportedChannels && !sourceConfig.supportedChannels.includes(event.channel as 'whatsapp' | 'messenger')) {
      throw new UnprocessableEntityException(`El canal ${event.channel} no está habilitado para ${source}`);
    }
    const contactId = event.ghl_contact_id;
    const message = String(event.message_body ?? '').trim();
    if (!contactId) throw new UnprocessableEntityException('El webhook requiere el Contact ID nativo de GHL');
    if (!message && (!event.message_attachments || event.message_attachments.length === 0)) {
      throw new UnprocessableEntityException('El webhook requiere el cuerpo del mensaje o al menos un attachment');
    }

    const nativeConversationId = event.ghl_conversation_id?.trim() || null;
    const isSyntheticConversation = !nativeConversationId || nativeConversationId.startsWith('contact:');
    const conversationId = nativeConversationId || `contact:${contactId}:${event.channel}`;
    const locationId = event.ghl_location_id || sourceConfig.locationId;
    const raw = rawBody || JSON.stringify(input);
    const eventId = event.event_id || `ghl:${source}:${hash(raw)}`;
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
    if (isSyntheticConversation) {
      await this.triggerTargetedGuardIfSplit(locationId, contactId, headers.testNow, message);
    }
    return response;
  }

  /**
   * A webhook without a native conversation id is stored under a contact-scoped
   * synthetic id. If that contact already has a canonical GHL conversation, or
   * the message looks like a phone candidate, ask the guard to reconcile only
   * this contact. This avoids waiting for the global batch and never replays
   * other dealers or contacts.
   */
  private async triggerTargetedGuardIfSplit(locationId: string, contactId: string, now?: Date, message = ''): Promise<void> {
    try {
      const split = await this.dataSource!.query(
        `SELECT 1
         FROM conversations
         WHERE ghl_location_id = $1
           AND ghl_contact_id = $2
           AND ghl_conversation_id IS NOT NULL
           AND ghl_conversation_id NOT LIKE 'contact:%'
         LIMIT 1`,
        [locationId, contactId],
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

  async processDueConversations(now = currentLocalNow(), options: { reconcileActive?: boolean; runGuard?: boolean; guardContactIds?: string[]; forceGuard?: boolean; dueContactIds?: string[] } = {}): Promise<DueConversationResponse> {
    return this.dueFunctions.processDueConversations(now, options);
  }

  async runGhlGuard(now = currentLocalNow(), options: { contactIds?: string[]; force?: boolean } = {}) {
    return this.guard.run(now, options);
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
      await this.processDueConversations(undefined, { reconcileActive: true });
    } catch {
      // Polling is best effort; the next cycle retries the pending work.
    } finally {
      this.duePollInFlight = false;
    }
  }

  // Compatibility facades keep focused unit tests and diagnostic callers stable
  // while the implementations live in dedicated modules.
  statusForConversation(...args: [ConversationSnapshot, LocationSnapshot, DealerRow, SourceKey, Date, 'capture' | 'due', string?]) {
    return this.qualification.statusForConversation(...args);
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
