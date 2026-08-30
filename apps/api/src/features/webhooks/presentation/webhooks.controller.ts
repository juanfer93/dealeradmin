import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookService } from '../application/webhook.service';
import { normalizeGhlOutboundPayload } from '../application/ghl-outbound-payload';
import { HmacSignatureGuard } from './hmac-signature.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @UseGuards(HmacSignatureGuard)
  receiveLead(@Req() request: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const normalizedBody = normalizeGhlOutboundPayload(body);
    return this.webhookService.acceptLead(normalizedBody, request.rawBody?.toString('utf8'));
  }
}
