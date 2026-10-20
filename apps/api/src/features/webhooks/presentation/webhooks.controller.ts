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
    });
  }

  @Get('ghl/conversations/process-due')
  @UseGuards(HmacSignatureGuard)
  async processDueConversationsCron(@Req() request: Request) {
    await this.ingressAudit.recoverStale();
    // GitHub Actions invokes this endpoint every five minutes. Keep the
    // request focused on due releases plus the GHL guard so the serverless
    // time budget is not consumed by the heavier active reconciliation pass.
    // The guard then fetches GHL messages and applies the existing additive
    // normalizer to fill only data missing locally because of latency.
    return this.conversationWebhookService.processDueConversations(undefined, {
      reconcileActive: false,
      runGuard: true,
      forceGuard: true,
      guardContactIds: String(request.query.contact_ids ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
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
}
