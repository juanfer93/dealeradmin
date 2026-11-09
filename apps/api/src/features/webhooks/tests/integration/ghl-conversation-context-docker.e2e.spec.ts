import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GhlConversationContextService } from '../../application/ghl-conversation-context.service';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';
import { WebhookIngressAuditService } from '../../application/webhook-ingress-audit.service';
import { WebhookProcessingAuditService } from '../../application/webhook-processing-audit.service';
import { WebhookService } from '../../application/webhook.service';
import { GhlContextSecretGuard } from '../../presentation/ghl-context-secret.guard';
import { WebhooksController } from '../../presentation/webhooks.controller';

const databaseUrl = process.env.GHL_CONTEXT_E2E_DATABASE_URL || process.env.DATABASE_URL;
const describeDockerDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;
const contextSecret = 'local-context-secret-for-docker-e2e-only';

describeDockerDatabase('GHL conversation memory HTTP E2E backed by the Docker database', () => {
  let dataSource: DataSource;
  let app: INestApplication | undefined;
  let baseUrl = '';
  let previousSecret: string | undefined;
  const contactId = `codex-docker-seller-${Date.now()}`;
  const conversationId = `${contactId}-conversation`;
  let locationId = '';

  beforeAll(async () => {
    previousSecret = process.env.GHL_CONTEXT_API_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.GHL_CONTEXT_API_SECRET = contextSecret;
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();

    const dealers = await dataSource.query(
      'SELECT id::text AS id, ghl_location_id FROM dealers WHERE active = true ORDER BY created_at LIMIT 1',
    ) as Array<{ id: string; ghl_location_id: string }>;
    if (!dealers[0]) throw new Error('The Docker database has no active dealer fixture');
    const dealer = dealers[0];
    locationId = dealer.ghl_location_id;
    const leadRows = await dataSource.query(
      `INSERT INTO leads (first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ('Carlos', 'Seller Test', $1, $2, 'arlington') RETURNING id::text AS id`,
      [contactId, locationId],
    ) as Array<{ id: string }>;
    const leadId = leadRows[0].id;
    const snapshot = {
      real_name: 'Carlos Seller Test',
      phone: '',
      vehicle_type: 'Tacoma 2021',
      vehicle_intent: 'sell',
      down_payment: '',
      purchase_timeline: '',
      documents: '',
      assigned_dealer_id: dealer.id,
      qualification_progress: { language: 'en' },
    };
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, vehicle_type, routing_status, assigned_dealer_id, status)
       VALUES ($1, $2::uuid, 'Tacoma 2021', 'resolved', $2::uuid, 'pending')`,
      [leadId, dealer.id],
    );
    const conversationRows = await dataSource.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status, qualification_snapshot)
       VALUES ($1, $2, $3, $4, 'messenger', 'queued', $5::jsonb) RETURNING id::text AS id`,
      [leadId, locationId, contactId, conversationId, JSON.stringify(snapshot)],
    ) as Array<{ id: string }>;
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, dedupe_key, direction, body, occurred_at)
       VALUES ($1, $2, 'inbound', 'I am selling my Tacoma 2021', CURRENT_TIMESTAMP)`,
      [conversationRows[0].id, `${contactId}-message`],
    );

    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhookService, useValue: {} },
        { provide: ConversationWebhookService, useValue: {} },
        { provide: WebhookIngressAuditService, useValue: { markAuth: async () => undefined } },
        { provide: WebhookProcessingAuditService, useValue: {} },
        { provide: GhlConversationContextService, useValue: new GhlConversationContextService(dataSource) },
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
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.destroy();
    }
    if (previousSecret === undefined) delete process.env.GHL_CONTEXT_API_SECRET;
    else process.env.GHL_CONTEXT_API_SECRET = previousSecret;
    process.env.NODE_ENV = 'test';
  });

  it('returns remembered seller intent from a Docker-persisted conversation without changing bot nextQuestion', async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/ghl/conversation-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DealerADMIN-Context-Secret': contextSecret },
      body: JSON.stringify({ locationId, contactId, conversationId, channel: 'messenger' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      known: { customer_name: 'Carlos Seller Test', vehicle_type: 'Tacoma 2021', vehicle_intent: 'sell' },
      nextQuestion: 'down_payment',
      contextStatus: 'fresh',
    });
  }, 20_000);
});
