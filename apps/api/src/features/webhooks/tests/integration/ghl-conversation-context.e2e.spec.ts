import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhlConversationContextService } from '../../application/ghl-conversation-context.service';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';
import { WebhookIngressAuditService } from '../../application/webhook-ingress-audit.service';
import { WebhookProcessingAuditService } from '../../application/webhook-processing-audit.service';
import { WebhookService } from '../../application/webhook.service';
import { GhlContextSecretGuard } from '../../presentation/ghl-context-secret.guard';
import { WebhooksController } from '../../presentation/webhooks.controller';

const contextSecret = 'local-context-secret-for-e2e-only';

describe('POST /api/webhooks/ghl/conversation-context (HTTP E2E, no Docker)', () => {
  const getContext = vi.fn();
  let app: INestApplication | undefined;
  let baseUrl = '';
  const previousSecret = process.env.GHL_CONTEXT_API_SECRET;

  beforeEach(() => getContext.mockClear());

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.GHL_CONTEXT_API_SECRET = contextSecret;
    getContext.mockResolvedValue({
      ok: true,
      source: 'dealeradmin',
      known: { customer_name: 'Ana Lopez', vehicle_type: 'SUV', down_payment: null, purchase_timeline: null, documents: null },
      missing: ['down_payment', 'purchase_timeline', 'documents'],
      nextQuestion: 'down_payment',
      contextStatus: 'fresh',
      contextUpdatedAt: '2026-11-09T12:00:00.000Z',
    });
    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhookService, useValue: {} },
        { provide: ConversationWebhookService, useValue: {} },
        { provide: WebhookIngressAuditService, useValue: { markAuth: vi.fn() } },
        { provide: WebhookProcessingAuditService, useValue: {} },
        { provide: GhlConversationContextService, useValue: { getContext } },
        GhlContextSecretGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const server = await app.listen(0, '127.0.0.1');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral HTTP port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 20_000);

  afterAll(async () => {
    if (app) await app.close();
    if (previousSecret === undefined) delete process.env.GHL_CONTEXT_API_SECRET;
    else process.env.GHL_CONTEXT_API_SECRET = previousSecret;
    process.env.NODE_ENV = 'test';
  });

  it('returns only structured DealerAdmin context for the pilot payload', async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/ghl/conversation-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DealerADMIN-Context-Secret': contextSecret },
      body: JSON.stringify({ locationId: 'stafford-location', contactId: 'contact-a', conversationId: 'conversation-a', channel: 'whatsapp' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ source: 'dealeradmin', nextQuestion: 'down_payment', contextStatus: 'fresh' });
    expect(getContext).toHaveBeenCalledWith({ locationId: 'stafford-location', contactId: 'contact-a', conversationId: 'conversation-a', channel: 'whatsapp' });
  });

  it('rejects missing or wrong credentials before reading context', async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/ghl/conversation-context`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId: 'stafford-location', contactId: 'contact-a' }),
    });

    expect(response.status).toBe(401);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('rejects malformed and out-of-contract input instead of querying a fallback identity', async () => {
    for (const body of [
      { locationId: 'stafford-location', contactId: 'contact-a', phone: '+15550000000' },
      { locationId: 'stafford-location', contactId: 'contact-a', channel: 'sms' },
      { locationId: 'stafford-location', contactId: 'contact a' },
    ]) {
      const response = await fetch(`${baseUrl}/api/webhooks/ghl/conversation-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DealerADMIN-Context-Secret': contextSecret },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(getContext).not.toHaveBeenCalled();
  });
});
