import { CanActivate, ExecutionContext, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { verifySharedSecret } from './hmac-signature.guard';
import { WebhookIngressAuditService } from '../application/webhook-ingress-audit.service';

type ContextRequest = Request & { webhookIngressRequestId?: string };

@Injectable()
export class GhlContextSecretGuard implements CanActivate {
  constructor(@Optional() @Inject(WebhookIngressAuditService) private readonly ingressAudit?: WebhookIngressAuditService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const configuredSecret = process.env.GHL_CONTEXT_API_SECRET?.trim();
    if (!configuredSecret) {
      void this.ingressAudit?.markAuth(request, 'rejected', 'context_secret_unconfigured');
      throw new ServiceUnavailableException('Context endpoint is not configured');
    }

    if (!verifySharedSecret(request.header('X-DealerADMIN-Context-Secret'), configuredSecret)) {
      void this.ingressAudit?.markAuth(request, 'rejected', 'invalid_context_secret');
      throw new UnauthorizedException('Invalid context credentials');
    }
    void this.ingressAudit?.markAuth(request, 'accepted', 'context_secret');
    return true;
  }
}
