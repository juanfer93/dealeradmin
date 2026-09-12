import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookService } from '../application/webhook.service';
import { normalizeGhlOutboundPayload } from '../application/ghl-outbound-payload';
import { HmacSignatureGuard } from './hmac-signature.guard';
import { ConversationWebhookService } from '../application/conversation-webhook.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly conversationWebhookService: ConversationWebhookService,
  ) {}

  @Post()
  @UseGuards(HmacSignatureGuard)
  receiveLead(@Req() request: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const normalizedBody = normalizeGhlOutboundPayload(body);
    return this.webhookService.acceptLead(normalizedBody, request.rawBody?.toString('utf8'));
  }

  @Post('ghl/customer-replied/:source')
  @UseGuards(HmacSignatureGuard)
  receiveCustomerReplied(
    @Param('source') source: string,
    @Req() request: Request & { rawBody?: Buffer },
    @Body() body: unknown,
  ) {
    return this.conversationWebhookService.acceptCustomerReplied(
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
  }

  @Post('ghl/conversations/process-due')
  @UseGuards(HmacSignatureGuard)
  processDueConversations(@Req() request: Request) {
    const requestedNow = request.header('X-DealerADMIN-Test-Now');
    return this.conversationWebhookService.processDueConversations(this.controlledTestNow(requestedNow));
  }

  private controlledTestNow(value: string | undefined): Date | undefined {
    const parsed = value ? new Date(value) : undefined;
    return process.env.NODE_ENV !== 'production' && parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  }
}
