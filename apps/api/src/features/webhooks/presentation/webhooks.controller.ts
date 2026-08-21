import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookService } from '../application/webhook.service';
import { HmacSignatureGuard } from './hmac-signature.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @UseGuards(HmacSignatureGuard)
  receiveLead(@Req() request: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    return this.webhookService.acceptLead(body, request.rawBody?.toString('utf8'));
  }
}
