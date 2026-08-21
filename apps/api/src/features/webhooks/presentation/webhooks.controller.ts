import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WebhookService } from '../application/webhook.service';
import { HmacSignatureGuard } from './hmac-signature.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @UseGuards(HmacSignatureGuard)
  receiveLead(@Body() body: unknown): { accepted: true; eventId: string } {
    return this.webhookService.acceptLead(body);
  }
}
