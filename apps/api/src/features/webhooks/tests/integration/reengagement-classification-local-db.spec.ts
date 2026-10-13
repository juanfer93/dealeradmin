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
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE conversation_id = $1', [conversationId]);
      await dataSource.query('DELETE FROM conversation_messages WHERE conversation_id = $1', [conversationId]);
      await dataSource.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    }
    for (const leadId of createdLeadIds) {
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id = $1', [leadId]);
      await dataSource.query('DELETE FROM conversations WHERE lead_id = $1', [leadId]);
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

  async function createSentLead(input: { name: string; phone: string; status?: string }) {
    const contactId = `sent-lead-contact-${randomUUID()}`;
    const leadRows = await dataSource.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES ($1, $2, $3, $4, $5, 'reengagement-classification-sent-test') RETURNING id`,
      [input.phone, input.name.split(' ')[0], input.name.split(' ').slice(1).join(' '), contactId, locationId],
    ) as Array<{ id: string }>;
    const leadId = leadRows[0].id;
    createdLeadIds.push(leadId);
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, vehicle_type, routing_status, status, sent_at, message_text)
       VALUES ($1, $2, 'SUV', 'resolved', $3, $4, $5)`,
      [leadId, dealerId, input.status || 'sent', input.status === 'sent' || !input.status ? '2026-10-13T17:00:00.000Z' : null, input.name],
    );
    return { leadId, phone: input.phone };
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

  it('reuses a sent lead when a new GHL contact returns with the same name and phone', async () => {
    const phoneSuffix = String(Date.now() % 10_000).padStart(4, '0');
    const testPhone = `+1771202${phoneSuffix}`;
    const sentLead = await createSentLead({ name: 'Daniel Morales', phone: testPhone });
    const existingGhl = await createLeadAndConversation({ name: 'Daniel Morales', phone: testPhone, status: 'partial', priorMessage: 'Estoy buscando una SUV' });
    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-sent-reengagement-${randomUUID()}`,
        occurred_at: '2026-10-13T18:00:00.000Z',
        message_body: `Mi número es 771-202-${phoneSuffix} y busco una SUV`,
        contact_phone: sentLead.phone,
        contact_name: 'Daniel Morales',
        channel: 'messenger',
      },
      source,
      { contactId: existingGhl.contactId, conversationId: existingGhl.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    for (const attempt of [2, 3]) {
      const repeatedResult = await service.acceptCustomerReplied(
        {
          event_id: `evt-sent-reengagement-${attempt}-${randomUUID()}`,
          occurred_at: `2026-10-13T18:0${attempt}:00.000Z`,
          message_body: attempt === 3 ? 'Sigo interesado, por favor escríbeme' : 'Sigo interesado',
          contact_phone: sentLead.phone,
          contact_name: 'Daniel Morales',
          channel: 'messenger',
        },
        source,
        { contactId: existingGhl.contactId, conversationId: existingGhl.conversationKey, testNow: new Date(`2026-10-13T18:0${attempt}:15.000Z`) },
      );
      expect(repeatedResult.status).toBe('processed');
    }

    const rows = await dataSource.query(
      `SELECT c.lead_id, c.status, ld.status AS dealer_status, ld.has_unhandled_reengagement, ld.reengagement_count,
              (SELECT COUNT(*)::int FROM leads WHERE canonical_phone = $1 AND first_name = 'Daniel') AS lead_count,
              (SELECT COUNT(*)::int FROM conversations WHERE lead_id = $2) AS conversation_count,
              (SELECT COUNT(*)::int FROM conversation_bot_pause_events WHERE conversation_id = c.id) AS pause_event_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.lead_id = $2`,
      [sentLead.phone, sentLead.leadId, dealerId],
    ) as Array<{ lead_id: string; status: string; dealer_status: string; has_unhandled_reengagement: boolean; reengagement_count: number; lead_count: number; conversation_count: number; pause_event_count: number }>;

    expect(rows).toEqual([{
      lead_id: sentLead.leadId,
      status: 'queued',
      dealer_status: 'pending',
      has_unhandled_reengagement: true,
      reengagement_count: 3,
      lead_count: 1,
      conversation_count: 1,
      pause_event_count: 1,
    }]);
  });

  it('reuses a manually created lead even when it has no previous conversation', async () => {
    const phoneSuffix = String((Date.now() + 1) % 10_000).padStart(4, '0');
    const testPhone = `+1771202${phoneSuffix}`;
    const sentLead = await createSentLead({ name: 'Manual Buyer', phone: testPhone, status: 'pending' });
    const contactId = `manual-reengagement-contact-${randomUUID()}`;
    const conversationId = `manual-reengagement-conversation-${randomUUID()}`;

    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-manual-sent-reengagement-${randomUUID()}`,
        occurred_at: '2026-10-13T18:30:00.000Z',
        message_body: `My number is 771-202-${phoneSuffix} and I am still interested`,
        contact_phone: sentLead.phone,
        contact_name: 'Manual Buyer',
        channel: 'messenger',
      },
      source,
      { contactId, conversationId, testNow: new Date('2026-10-13T18:30:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.lead_id, c.status, ld.status AS dealer_status, ld.has_unhandled_reengagement, ld.reengagement_count,
              (SELECT COUNT(*)::int FROM leads WHERE canonical_phone = $1 AND first_name = 'Manual') AS lead_count,
              (SELECT COUNT(*)::int FROM conversations WHERE lead_id = $2) AS conversation_count,
              (SELECT COUNT(*)::int FROM conversation_bot_pause_events WHERE conversation_id = c.id) AS pause_event_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.ghl_conversation_id = $4`,
      [sentLead.phone, sentLead.leadId, dealerId, conversationId],
    ) as Array<{ lead_id: string; status: string; dealer_status: string; has_unhandled_reengagement: boolean; reengagement_count: number; lead_count: number; conversation_count: number; pause_event_count: number }>;

    expect(rows).toEqual([{
      lead_id: sentLead.leadId,
      status: 'queued',
      dealer_status: 'pending',
      has_unhandled_reengagement: true,
      reengagement_count: 1,
      lead_count: 1,
      conversation_count: 1,
      pause_event_count: 1,
    }]);
  });
});
