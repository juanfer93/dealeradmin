import { Module } from '@nestjs/common';
import { WebhookService } from '../application/webhook.service';
import { HmacSignatureGuard } from './hmac-signature.guard';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [WebhooksController],
  providers: [WebhookService, HmacSignatureGuard],
})
export class WebhooksModule {}
