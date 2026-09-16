import { Module } from '@nestjs/common';
import { WebhookService } from '../application/webhook.service';
import { HmacSignatureGuard } from './hmac-signature.guard';
import { WebhooksController } from './webhooks.controller';
import { RoutingModule } from '../../routing/presentation/routing.module';
import { ConversationWebhookService } from '../application/conversation-webhook.service';
import { GhlQueuedPauseNotifier } from '../application/conversation-bot-pause';
import { QUEUED_PAUSE_NOTIFIER } from './queued-pause.tokens';

@Module({
  imports: [RoutingModule],
  controllers: [WebhooksController],
  providers: [
    WebhookService,
    ConversationWebhookService,
    HmacSignatureGuard,
    { provide: QUEUED_PAUSE_NOTIFIER, useClass: GhlQueuedPauseNotifier },
  ],
  exports: [ConversationWebhookService],
})
export class WebhooksModule {}
