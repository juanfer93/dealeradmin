import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import {
  isQueuedPauseSourceEnabled,
  isQueuedTransition,
  QUEUED_PAUSE_HOURS,
  type QueuedPauseNotifier,
  type QueuedPausePayload,
} from '../../conversation-bot-pause';
import { configureWebhookTransactionSafety } from '../../transaction-safety';

type QueueSourceConfig = Record<string, { locationId: string }>;

export type QueuedPauseDispatch = { source: string; payload: QueuedPausePayload };

type QueuedPauseEventInput = {
  conversationId: string;
  ghlConversationId: string;
  contactId: string;
  locationId: string;
  leadId: string;
  source: string;
  emittedAt: Date;
  force?: boolean;
};

type PendingQueuedPauseRow = {
  event_id: string;
  ghl_conversation_id: string;
  ghl_contact_id: string;
  ghl_location_id: string;
  lead_id: string;
  emitted_at: string | Date;
};

export class ConversationQueueService {
  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly notifier: QueuedPauseNotifier | undefined,
    private readonly sourceConfig: QueueSourceConfig,
  ) {}

  async queueLeadForBotSilence(leadId: string, emittedAt = new Date()): Promise<{ queued: boolean; eventId?: string }> {
    if (!this.dataSource) return { queued: false };

    const runner = this.dataSource.createQueryRunner();
    let queuedPauseEvent: QueuedPauseDispatch | null = null;
    await runner.connect();
    await runner.startTransaction();
    try {
      await configureWebhookTransactionSafety(runner);
      const rows = await runner.query(
        `SELECT c.id, c.status, c.ghl_location_id, c.ghl_contact_id, c.ghl_conversation_id, c.lead_id
         FROM conversations c
         WHERE c.lead_id = $1
         ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [leadId],
      ) as Array<{ id: string; status: string; ghl_location_id: string; ghl_contact_id: string; ghl_conversation_id: string; lead_id: string }>;
      const conversation = rows[0];
      if (!conversation) {
        await runner.commitTransaction();
        return { queued: false };
      }

      const sourceEntry = Object.entries(this.sourceConfig).find(([, config]) => config.locationId === conversation.ghl_location_id);
      if (!sourceEntry) throw new BadRequestException(`No existe una fuente GHL para la Location ID ${conversation.ghl_location_id}`);
      const source = sourceEntry[0];

      // Keep the operator's sent relation while cycling the conversation
      // through queued so the existing durable bot-silence event is emitted.
      await runner.query(
        `UPDATE conversations SET status = 'sent', next_attempt_at = NULL, waiting_window_attempts = 0, waiting_window_started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [conversation.id],
      );
      queuedPauseEvent = await this.createQueuedPauseEvent(runner, 'sent', 'queued', {
        conversationId: conversation.id,
        ghlConversationId: conversation.ghl_conversation_id,
        contactId: conversation.ghl_contact_id,
        locationId: conversation.ghl_location_id,
        leadId: conversation.lead_id,
        source,
        emittedAt,
      });
      await runner.query(
        `UPDATE conversations SET status = 'queued', next_attempt_at = NULL, waiting_window_attempts = 0, waiting_window_started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [conversation.id],
      );
      await runner.commitTransaction();
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    if (queuedPauseEvent) await this.dispatchQueuedPauseEvent(queuedPauseEvent);
    return { queued: true, eventId: queuedPauseEvent?.payload.eventId };
  }

  async createQueuedPauseEvent(
    runner: QueryRunner,
    previousStatus: string | null | undefined,
    nextStatus: string,
    input: QueuedPauseEventInput,
  ): Promise<QueuedPauseDispatch | null> {
    if ((!input.force && !isQueuedTransition(previousStatus, nextStatus)) || !isQueuedPauseSourceEnabled(input.source)) return null;
    if (this.sourceConfig[input.source]?.locationId !== input.locationId) {
      throw new BadRequestException(`Location ID no coincide con la fuente GHL ${input.source}`);
    }

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

  async dispatchQueuedPauseEvent(event: QueuedPauseDispatch): Promise<void> {
    if (!this.dataSource || !this.notifier) return;
    try {
      const result = await this.notifier.send(event.source, event.payload);
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
    if (!this.dataSource || !this.notifier) return 0;
    const rows = await this.dataSource.query(
      `SELECT event_id, ghl_conversation_id, ghl_contact_id, ghl_location_id, lead_id, emitted_at
       FROM conversation_bot_pause_events
       WHERE status IN ('pending', 'failed')
       ORDER BY created_at ASC
       LIMIT 25`,
    ) as PendingQueuedPauseRow[];
    let processed = 0;
    for (const row of rows) {
      const configured = Object.entries(this.sourceConfig).find(([, config]) => config.locationId === row.ghl_location_id);
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
        source: configured[0],
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
}
