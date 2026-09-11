import { Module } from '@nestjs/common';
import { WebhookService } from '../application/webhook.service';
import { HmacSignatureGuard } from './hmac-signature.guard';
import { WebhooksController } from './webhooks.controller';
import { RoutingModule } from '../../routing/presentation/routing.module';
import { ConversationWebhookService } from '../application/conversation-webhook.service';

@Module({
  imports: [RoutingModule],
  controllers: [WebhooksController],
  providers: [WebhookService, ConversationWebhookService, HmacSignatureGuard],
  exports: [ConversationWebhookService],
})
export class WebhooksModule {}
