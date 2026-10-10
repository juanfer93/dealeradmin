import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { WebhookIngressAuditService } from '../application/webhook-ingress-audit.service';

type RawBodyRequest = Request & { rawBody?: Buffer; webhookIngressRequestId?: string };

@Injectable()
export class WebhookIngressAuditMiddleware implements NestMiddleware {
  constructor(private readonly audit: WebhookIngressAuditService) {}

  async use(request: RawBodyRequest, response: Response, next: NextFunction): Promise<void> {
    const requestId = await this.audit.begin(request, request.body);
    request.webhookIngressRequestId = requestId;

    if (requestId) {
      let completed = false;
      const complete = (connectionClosed: boolean) => {
        if (completed) return;
        completed = true;
        void this.audit.complete(requestId, { statusCode: response.statusCode, connectionClosed });
      };
      response.once('finish', () => complete(false));
      response.once('close', () => complete(!response.writableFinished));
    }
    next();
  }
}
