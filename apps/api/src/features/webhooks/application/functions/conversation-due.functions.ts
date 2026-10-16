import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { findQueuedConversationDuplicate } from '../../../leads/domain/lead-duplicate';
import { ConversationQueueService, type QueuedPauseDispatch } from './conversation-queue.service';
import { ConversationQualificationFunctions } from './conversation-qualification.functions';
import { ConversationReconciliationFunctions } from './conversation-reconciliation.functions';
import { DUE_CONVERSATION_BATCH_SIZE, GHL_SOURCE_CONFIG } from './conversation-webhook.config';
import { clean } from './conversation-webhook.helpers';
import type { ConversationSnapshot, LocationSnapshot, DueConversationResponse, SourceConfigMap, SourceKey } from './conversation-webhook.types';
import type { GhlGuardRunResult, GhlGuardService } from '../ghl-guard.service';

export class ConversationDueFunctions {
  constructor(
    private readonly dataSource: DataSource | undefined,
    private readonly qualification: ConversationQualificationFunctions,
    private readonly queueService: ConversationQueueService,
    private readonly reconciliation: ConversationReconciliationFunctions,
    private readonly sourceConfig: SourceConfigMap = GHL_SOURCE_CONFIG,
    private readonly guard?: GhlGuardService,
  ) {}

  async processDueConversations(now: Date, options: { reconcileActive?: boolean } = {}): Promise<DueConversationResponse> {
    if (!this.dataSource) {
      if (process.env.NODE_ENV === 'test') return { accepted: true, processed: 0 };
      throw new ServiceUnavailableException('Database connection is not available');
    }
    await this.dataSource.query(
      `UPDATE conversations SET next_attempt_at = $1::timestamptz, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'waiting_window' AND next_attempt_at IS NULL`,
      [now.toISOString()],
    );
    const due = await this.dataSource.query(
      `SELECT c.id FROM conversations c
       WHERE c.status = 'waiting_window' AND c.next_attempt_at IS NOT NULL AND c.next_attempt_at <= $1
       ORDER BY c.next_attempt_at ASC LIMIT $2`,
      [now.toISOString(), DUE_CONVERSATION_BATCH_SIZE],
    ) as Array<{ id: string }>;
    let processed = 0;
    for (const row of due) {
      if (await this.releaseDueConversation(row.id, now)) processed += 1;
    }
    if (options.reconcileActive !== false) await this.reconciliation.reconcileActiveConversations(now);
    let guardResult: GhlGuardRunResult | undefined;
    let guardError: string | undefined;
    if (options.reconcileActive !== false) {
      try {
        // Reconciliation can take longer than the caller's initial timestamp.
        // The guard must lease from the real execution time, not that stale timestamp.
        guardResult = await this.guard?.run(new Date());
      } catch (error) {
        // The GHL guard is a repair/audit layer; it must never block due releases.
        guardError = error instanceof Error ? error.name : 'GHL_GUARD_RUN_FAILED';
      }
    }
    return {
      accepted: true,
      processed,
      ...(guardResult ? { guard: guardResult } : {}),
      ...(guardError ? { guardError } : {}),
    };
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
         FROM conversations c JOIN leads l ON l.id = c.lead_id
         WHERE c.id = $1 AND c.status = 'waiting_window' AND c.next_attempt_at <= $2
         FOR UPDATE`,
        [id, now.toISOString()],
      ) as Array<{ id: string; ghl_location_id: string; ghl_contact_id: string; ghl_conversation_id: string; qualification_snapshot: ConversationSnapshot; location_snapshot: LocationSnapshot; ready_at: string | null; lead_id: string; first_name: string | null; last_name: string | null }>;
      if (!rows[0]) {
        await runner.rollbackTransaction();
        return false;
      }
      const row = rows[0];
      const configuredSource = Object.entries(this.sourceConfig).find(([, config]) => config.locationId === row.ghl_location_id)?.[0];
      if (!configuredSource) throw new BadRequestException(`Fuente GHL no configurada para la Location ID ${row.ghl_location_id}`);
      const source = configuredSource as SourceKey;
      const dealer = await this.qualification.findSourceDealer(runner, row.ghl_location_id, source, row.qualification_snapshot.language, clean(row.qualification_snapshot.assigned_dealer_id) || undefined);
      const status = this.qualification.statusForConversation(row.qualification_snapshot, row.location_snapshot, dealer, source, now, 'due', row.ready_at);
      if (status.status !== 'ready') {
        await runner.query(
          `UPDATE conversations SET status = $2, next_attempt_at = $3,
             ready_at = CASE WHEN $2::varchar IN ('ready', 'waiting_window', 'queued') THEN COALESCE(ready_at, $4::timestamptz) ELSE ready_at END,
             updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
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
        await runner.query(`UPDATE conversations SET status = 'duplicate_ignored', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        await runner.commitTransaction();
        return false;
      }
      await this.qualification.syncLeadDealer(runner, dealer, row.lead_id, row.qualification_snapshot, row.location_snapshot, source);
      await runner.query(`UPDATE conversations SET status = 'queued', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
      queuedPauseEvent = await this.queueService.createQueuedPauseEvent(runner, 'waiting_window', 'queued', {
        conversationId: row.id,
        ghlConversationId: row.ghl_conversation_id,
        contactId: row.ghl_contact_id,
        locationId: row.ghl_location_id,
        leadId: row.lead_id,
        source,
        emittedAt: now,
      });
      await runner.commitTransaction();
      if (queuedPauseEvent) await this.queueService.dispatchQueuedPauseEvent(queuedPauseEvent);
      return true;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}
