import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService, GHL_SOURCE_CONFIG } from '../../application/conversation-webhook.service';

const runDatabaseCase = process.env.RUN_REENGAGEMENT_CLASSIFICATION_DB === '1';
const describeDatabaseCase = runDatabaseCase ? describe : describe.skip;

describeDatabaseCase('new contact versus reengagement classification with local PostgreSQL', () => {
  let dataSource: DataSource;
  let service: ConversationWebhookService;
  const source = 'arlington' as const;
  const locationId = GHL_SOURCE_CONFIG[source].locationId;
  let dealerId: string;
  const createdLeadIds: string[] = [];
  const createdConversationIds: string[] = [];

  beforeAll(async () => {
    const databaseUrl = process.env.REENGAGEMENT_CLASSIFICATION_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl || !/(localhost|127\.0\.0\.1)/i.test(databaseUrl)) {
      throw new Error('RUN_REENGAGEMENT_CLASSIFICATION_DB requires a localhost PostgreSQL URL');
    }
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
    service = new ConversationWebhookService(dataSource);
    const dealers = await dataSource.query(
      `SELECT id FROM dealers WHERE active = true AND ghl_location_id = $1 LIMIT 1`,
      [locationId],
    ) as Array<{ id: string }>;
    if (!dealers[0]) throw new Error(`No active dealer configured for Stafford location ${locationId}`);
    dealerId = dealers[0].id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const conversationId of createdConversationIds) {
      await dataSource.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    }
    for (const leadId of createdLeadIds) {
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id = $1', [leadId]);
      await dataSource.query('DELETE FROM leads WHERE id = $1', [leadId]);
    }
    await dataSource.destroy();
  });

  async function createLeadAndConversation(input: { name: string; phone: string; status: string; priorMessage?: string }) {
    const contactId = `classification-contact-${randomUUID()}`;
    const conversationKey = `classification-conversation-${randomUUID()}`;
    const leadRows = await dataSource.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, $2, $3, $4, $5, 'reengagement-classification-test') RETURNING id`,
      [input.phone, input.name.split(' ')[0], input.name.split(' ').slice(1).join(' '), contactId, locationId],
    ) as Array<{ id: string }>;
    const leadId = leadRows[0].id;
    createdLeadIds.push(leadId);
    const conversationRows = await dataSource.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status, qualification_snapshot)
       VALUES ($1, $2, $3, $4, 'whatsapp', $5, $6::jsonb) RETURNING id`,
      [leadId, locationId, contactId, conversationKey, input.status, JSON.stringify({ real_name: input.name, phone: input.phone, vehicle_type: 'SUV' })],
    ) as Array<{ id: string }>;
    const conversationId = conversationRows[0].id;
    createdConversationIds.push(conversationId);
    if (input.priorMessage) {
      await dataSource.query(
        `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [conversationId, `prior-${conversationKey}`, `prior-message-${conversationKey}`, input.priorMessage, '2026-10-12T18:00:00.000Z'],
      );
    }
    return { contactId, conversationKey, leadId, conversationId, phone: input.phone };
  }

  it('routes a queued conversation with no old messages through the new-contact flow', async () => {
    const fixture = await createLeadAndConversation({ name: 'Alex Rivas', phone: '+17712024963', status: 'queued' });

    const result = await service.acceptCustomerReplied(
      { event_id: `evt-new-${fixture.contactId}`, message_body: `My number is ${fixture.phone} and I am looking for an SUV`, contact_phone: fixture.phone, contact_name: 'Alex Rivas', channel: 'messenger' },
      source,
      { contactId: fixture.contactId, conversationId: fixture.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.status, COUNT(cm.id)::int AS message_count,
              COUNT(ld.lead_id)::int AS dealer_relation_count,
              COALESCE(BOOL_OR(ld.has_unhandled_reengagement), false) AS reengagement
       FROM conversations c
       LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
       LEFT JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $2
       WHERE c.id = $1
       GROUP BY c.id, c.status`,
      [fixture.conversationId, dealerId],
    ) as Array<{ status: string; message_count: number; dealer_relation_count: number; reengagement: boolean }>;

    expect(rows).toEqual([{ status: 'partial', message_count: 1, dealer_relation_count: 0, reengagement: false }]);
    expect(await dataSource.query('SELECT COUNT(*)::int AS count FROM leads WHERE id = $1', [fixture.leadId])).toEqual([{ count: 1 }]);
  });

  it('marks only a conversation with old messages as reengagement without creating another lead', async () => {
    const fixture = await createLeadAndConversation({ name: 'Historical Buyer', phone: '+17712024964', status: 'queued', priorMessage: `My number is ${'+17712024964'} and I am looking for an SUV` });
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, vehicle_type, routing_status, status, message_text)
       VALUES ($1, $2, 'SUV', 'resolved', 'pending', 'Historical Buyer')`,
      [fixture.leadId, dealerId],
    );

    const result = await service.acceptCustomerReplied(
      { event_id: `evt-old-${fixture.contactId}`, message_body: 'I am still interested', contact_phone: fixture.phone, contact_name: 'Historical Buyer', channel: 'messenger' },
      source,
      { contactId: fixture.contactId, conversationId: fixture.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.status,
              (SELECT COUNT(*)::int FROM leads WHERE id = $1) AS lead_count,
              (SELECT COUNT(*)::int FROM conversations WHERE id = $2) AS conversation_count,
              ld.status AS dealer_status, ld.has_unhandled_reengagement
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.id = $2`,
      [fixture.leadId, fixture.conversationId, dealerId],
    ) as Array<{ status: string; lead_count: number; conversation_count: number; dealer_status: string; has_unhandled_reengagement: boolean }>;

    expect(rows).toEqual([{ status: 'queued', lead_count: 1, conversation_count: 1, dealer_status: 'pending', has_unhandled_reengagement: true }]);
  });
});
