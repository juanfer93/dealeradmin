import { Module } from '@nestjs/common';
import { WebhookService } from '../application/webhook.service';
import { HmacSignatureGuard } from './hmac-signature.guard';
import { WebhooksController } from './webhooks.controller';
import { RoutingModule } from '../../routing/presentation/routing.module';

@Module({
  imports: [RoutingModule],
  controllers: [WebhooksController],
  providers: [WebhookService, HmacSignatureGuard],
})
export class WebhooksModule {}
