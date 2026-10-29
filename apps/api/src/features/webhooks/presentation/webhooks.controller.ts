import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookService } from '../application/webhook.service';
import { normalizeGhlOutboundPayload } from '../application/ghl-outbound-payload';
import { HmacSignatureGuard } from './hmac-signature.guard';
import { ConversationWebhookService } from '../application/conversation-webhook.service';
import { WebhookIngressAuditService } from '../application/webhook-ingress-audit.service';
import { WebhookProcessingAuditService } from '../application/webhook-processing-audit.service';

type WebhookRequest = Request & { rawBody?: Buffer; webhookIngressRequestId?: string };

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly conversationWebhookService: ConversationWebhookService,
    private readonly ingressAudit: WebhookIngressAuditService,
    private readonly processingAudit: WebhookProcessingAuditService,
  ) {}

  @Post()
  @UseGuards(HmacSignatureGuard)
  async receiveLead(@Req() request: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    void this.ingressAudit.markHandlerStarted(request);
    try {
      const normalizedBody = normalizeGhlOutboundPayload(body);
      return await this.webhookService.acceptLead(normalizedBody, request.rawBody?.toString('utf8'));
    } catch (error) {
      void this.ingressAudit.markError(request, error);
      throw error;
    }
  }

  @Post('ghl/customer-replied/:source')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HmacSignatureGuard)
  async receiveCustomerReplied(
    @Param('source') source: string,
    @Req() request: WebhookRequest,
    @Body() body: unknown,
  ) {
    void this.ingressAudit.markHandlerStarted(request);
    try {
      const response = await this.conversationWebhookService.acceptCustomerReplied(
        body,
        source,
        {
          contactId: request.header('X-DealerADMIN-Contact-ID') ?? undefined,
          conversationId: request.header('X-DealerADMIN-Conversation-ID') ?? undefined,
          messageId: request.header('X-DealerADMIN-Message-ID') ?? undefined,
          requestId: request.webhookIngressRequestId,
          testNow: this.controlledTestNow(request.header('X-DealerADMIN-Test-Now')),
        },
        request.rawBody?.toString('utf8'),
      );
      await this.processingAudit.recordFromPayload({
        requestId: request.webhookIngressRequestId,
        source,
        eventId: response.eventId,
        status: response.status,
        body,
        headers: {
          contactId: request.header('X-DealerADMIN-Contact-ID') ?? undefined,
          conversationId: request.header('X-DealerADMIN-Conversation-ID') ?? undefined,
          messageId: request.header('X-DealerADMIN-Message-ID') ?? undefined,
        },
      });
      return response.status === 'ignored_channel' ? undefined : response;
    } catch (error) {
      await this.ingressAudit.markError(request, error);
      throw error;
    }
  }

  @Post('ghl/conversations/process-due')
  @UseGuards(HmacSignatureGuard)
  async processDueConversations(@Req() request: Request) {
    await this.ingressAudit.recoverStale();
    const requestedNow = request.header('X-DealerADMIN-Test-Now');
    return this.conversationWebhookService.processDueConversations(this.controlledTestNow(requestedNow), {
      // HTTP E2E runs against the real database but must only release the
      // explicit due-window rows; bounded historical reconciliation is covered
      // by the service integration tests and would make this endpoint race the
      // test fixture's own webhook sequence.
      reconcileActive: process.env.NODE_ENV !== 'test',
      runGuard: false,
    });
  }

  @Get('ghl/conversations/process-due')
  @UseGuards(HmacSignatureGuard)
  async processDueConversationsCron(@Req() request: Request) {
    await this.ingressAudit.recoverStale();
    // This legacy endpoint now releases due rows independently. Guard runs
    // through /run-guard so a slow or leased GHL read cannot delay a cycle.
    const guardContactIds = this.queryContactIds(request);
    return this.conversationWebhookService.processDueConversations(undefined, {
      reconcileActive: false,
      runGuard: false,
      dueContactIds: guardContactIds,
      recentOnly: true,
    });
  }

  @Get('ghl/conversations/process-due-only')
  @UseGuards(HmacSignatureGuard)
  async processDueConversationsOnlyCron(@Req() request: Request) {
    const dueContactIds = this.queryContactIds(request);
    return this.conversationWebhookService.processDueConversations(undefined, {
      reconcileActive: false,
      // Every waiting-window cycle returns the due contacts for the separate
      // Guard job. The due release itself must never wait on GHL.
      runGuard: false,
      dueContactIds,
      recentOnly: true,
    });
  }

  @Get('ghl/conversations/due-health')
  @UseGuards(HmacSignatureGuard)
  async dueConversationHealth(@Req() request: Request) {
    return this.conversationWebhookService.getDueConversationHealth({ recentOnly: request.query.recent_only === 'true' });
  }

  @Get('ghl/conversations/watchdog')
  @UseGuards(HmacSignatureGuard)
  async dueConversationWatchdog() {
    const healthBefore = await this.conversationWebhookService.getDueConversationHealth({ recentOnly: true });
    const guardRetryContactIds = healthBefore.guardRetryContactIds ?? [];
    const needsRelease = healthBefore.overdueCount > 0
      || healthBefore.missingNextAttemptCount > 0
      || guardRetryContactIds.length > 0;
    if (!needsRelease) {
      return {
        accepted: true,
        triggered: false,
        skipped: 0,
        remainingDue: 0,
        guardContactIds: [],
        healthBefore,
        healthAfter: healthBefore,
      };
    }

    const release = await this.conversationWebhookService.processDueConversations(undefined, {
      reconcileActive: false,
      runGuard: false,
      recentOnly: true,
    });
    const healthAfter = await this.conversationWebhookService.getDueConversationHealth({ recentOnly: true });
    return {
      accepted: release.skipped === 0
        && healthAfter.overdueCount === 0
        && healthAfter.missingNextAttemptCount === 0,
      triggered: true,
      skipped: release.skipped,
      remainingDue: healthAfter.overdueCount,
      guardContactIds: [...new Set([
        ...(release.guardContactIds ?? []),
        ...guardRetryContactIds,
      ])],
      healthBefore,
      release,
      healthAfter,
    };
  }

  @Get('ghl/conversations/automatic-cycle')
  @UseGuards(HmacSignatureGuard)
  async automaticCycle() {
    const healthBefore = await this.conversationWebhookService.getDueConversationHealth({ recentOnly: true });
    const guardRetryContactIds = healthBefore.guardRetryContactIds ?? [];
    const needsRelease = healthBefore.overdueCount > 0
      || healthBefore.missingNextAttemptCount > 0
      || guardRetryContactIds.length > 0;
    const guardRetryOptions = guardRetryContactIds.length > 0
      ? { guardContactIds: guardRetryContactIds }
      : {};
    const release = needsRelease
      ? await this.conversationWebhookService.processDueConversations(undefined, {
        reconcileActive: false,
        runGuard: true,
        forceGuard: true,
        ...guardRetryOptions,
        recentOnly: true,
      })
      : {
        accepted: true,
        processed: 0,
        advanced: 0,
        skipped: 0,
        remainingDue: 0,
        guardContactIds: [],
        guardError: undefined,
      };
    const queuedBackup = await this.conversationWebhookService.runGhlGuard(undefined, {
      contactIds: [],
      queuedOnly: true,
      force: true,
      recentOnly: true,
    });
    const healthAfter = await this.conversationWebhookService.getDueConversationHealth({ recentOnly: true });
    return {
      accepted: release.accepted
        && release.skipped === 0
        && release.remainingDue === 0
        && !release.guardError
        && queuedBackup.failed === 0,
      triggered: needsRelease,
      healthBefore,
      release,
      queuedBackup,
      healthAfter,
    };
  }

  @Get('ghl/conversations/run-guard')
  @UseGuards(HmacSignatureGuard)
  async runGuardCron(@Req() request: Request) {
    const contactIds = this.queryContactIds(request);
    const queuedOnly = request.query.queued_backup === 'true';
    const guard = await this.conversationWebhookService.runGhlGuard(undefined, {
      contactIds,
      queuedOnly,
      // Targeted repairs bypass the interval; scheduled global runs respect it
      // and avoid unnecessary lease contention.
      force: contactIds.length > 0 || queuedOnly,
      recentOnly: queuedOnly,
    });
    const queuedReplaySelected = guard.queuedReplaySelected ?? 0;
    const queuedReplayCompleted = guard.queuedReplayCompleted ?? 0;
    const accepted = queuedOnly
      ? !guard.skipped
        && guard.failed === 0
        && queuedReplaySelected === queuedReplayCompleted
        // A scheduled backup owns one bounded batch. A successful batch must
        // be acknowledged even when older queued rows remain for later
        // cycles; requiring the global backlog to be zero made every cycle
        // fail forever once historical queued rows existed.
        && (queuedReplaySelected > 0 || (guard.pendingQueuedReplayCount ?? 0) === 0)
      : !guard.skipped || guard.skipReason === 'in_memory_interval';
    return { accepted, guard };
  }

  @Get('ghl/replay-failed')
  @UseGuards(HmacSignatureGuard)
  replayFailedWebhooks(@Req() request: Request) {
    const sinceValue = String(request.query.since ?? '').trim();
    const since = sinceValue ? new Date(sinceValue) : undefined;
    const limitValue = Number(request.query.limit ?? 250);
    return this.conversationWebhookService.replayFailedIngress({
      since: since && !Number.isNaN(since.getTime()) ? since : undefined,
      limit: Number.isFinite(limitValue) ? limitValue : 250,
    });
  }

  @Post('ghl/conversations/:conversationId/reconcile-media')
  @UseGuards(HmacSignatureGuard)
  reconcileMediaConversation(@Param('conversationId') conversationId: string, @Req() request: Request) {
    return this.conversationWebhookService.reconcileMediaConversation(
      conversationId,
      this.controlledTestNow(request.header('X-DealerADMIN-Test-Now')),
    );
  }

  private controlledTestNow(value: string | undefined): Date | undefined {
    const parsed = value ? new Date(value) : undefined;
    return process.env.NODE_ENV !== 'production' && parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  }

  private queryContactIds(request: Request): string[] {
    return String(request.query.contact_ids ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
}
