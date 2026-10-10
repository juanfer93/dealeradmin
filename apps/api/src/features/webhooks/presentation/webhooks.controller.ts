import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookService } from '../application/webhook.service';
import { normalizeGhlOutboundPayload } from '../application/ghl-outbound-payload';
import { HmacSignatureGuard } from './hmac-signature.guard';
import { ConversationWebhookService } from '../application/conversation-webhook.service';
import { WebhookIngressAuditService } from '../application/webhook-ingress-audit.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly conversationWebhookService: ConversationWebhookService,
    private readonly ingressAudit: WebhookIngressAuditService,
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
    @Req() request: Request & { rawBody?: Buffer },
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
          testNow: this.controlledTestNow(request.header('X-DealerADMIN-Test-Now')),
        },
        request.rawBody?.toString('utf8'),
      );
      return response.status === 'ignored_channel' ? undefined : response;
    } catch (error) {
      await this.ingressAudit.markError(request, error);
      throw error;
    }
  }

  @Post('ghl/conversations/process-due')
  @UseGuards(HmacSignatureGuard)
  processDueConversations(@Req() request: Request) {
    const requestedNow = request.header('X-DealerADMIN-Test-Now');
    return this.conversationWebhookService.processDueConversations(this.controlledTestNow(requestedNow));
  }

  @Get('ghl/conversations/process-due')
  @UseGuards(HmacSignatureGuard)
  processDueConversationsCron() {
    // The bounded active reconciliation repairs old partial conversations
    // whose phone/vehicle/down evidence was already persisted in messages.
    return this.conversationWebhookService.processDueConversations();
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
