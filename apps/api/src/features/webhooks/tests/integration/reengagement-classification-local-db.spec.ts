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
      await dataSource.query(
        `UPDATE conversations
         SET first_message_at = '2026-10-12T18:00:00.000Z', last_message_at = '2026-10-12T18:00:00.000Z'
         WHERE id = $1`,
        [conversationId],
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
    return { leadId, contactId, phone: input.phone };
  }

  async function createConversationForLead(input: { leadId: string; contactId: string; conversationKey: string; createdAt: string; status?: string }) {
    const conversationRows = await dataSource.query(
      `INSERT INTO conversations (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status, created_at, first_message_at, last_message_at)
       VALUES ($1, $2, $3, $4, 'whatsapp', $5, $6, $6, $6) RETURNING id`,
      [input.leadId, locationId, input.contactId, input.conversationKey, input.status || 'partial', input.createdAt],
    ) as Array<{ id: string }>;
    const conversationId = conversationRows[0].id;
    createdConversationIds.push(conversationId);
    return { conversationId, conversationKey: input.conversationKey };
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

  it('does not classify a same-conversation reply before 24 hours', async () => {
    const testPhone = `+1771202${String(Date.now() % 10000).padStart(4, '0')}`;
    const fixture = await createLeadAndConversation({
      name: 'Agustin Galicia',
      phone: testPhone,
      status: 'queued',
      priorMessage: 'I am interested in a truck and this is my first conversation',
    });
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, vehicle_type, routing_status, status, message_text)
       VALUES ($1, $2, 'truck', 'resolved', 'pending', 'Agustin Galicia')`,
      [fixture.leadId, dealerId],
    );

    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-new-same-conversation-${randomUUID()}`,
        occurred_at: '2026-10-12T18:20:00.000Z',
        message_body: `My number is ${fixture.phone} and I want a truck`,
        contact_phone: fixture.phone,
        contact_name: 'Agustin Galicia',
        channel: 'whatsapp',
      },
      source,
      { contactId: fixture.contactId, conversationId: fixture.conversationKey, testNow: new Date('2026-10-12T18:27:00.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.status, ld.has_unhandled_reengagement, ld.reengagement_count,
              (SELECT COUNT(*)::int FROM leads WHERE canonical_phone = $1) AS lead_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $2
       WHERE c.id = $3`,
      [fixture.phone, dealerId, fixture.conversationId],
    ) as Array<{ status: string; has_unhandled_reengagement: boolean; reengagement_count: number; lead_count: number }>;

    expect(rows).toEqual([{ status: 'queued', has_unhandled_reengagement: false, reengagement_count: 0, lead_count: 1 }]);
  });

  it('classifies a same-conversation reply after 24 hours without creating another lead', async () => {
    const testPhone = `+1771202${String((Date.now() + 3) % 10000).padStart(4, '0')}`;
    const fixture = await createLeadAndConversation({
      name: 'Same Conversation Buyer',
      phone: testPhone,
      status: 'queued',
      priorMessage: `My number is ${testPhone} and I am looking for an SUV`,
    });
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, vehicle_type, routing_status, status, message_text)
       VALUES ($1, $2, 'SUV', 'resolved', 'pending', 'Same Conversation Buyer')`,
      [fixture.leadId, dealerId],
    );
    await dataSource.query(
      `UPDATE conversations
       SET created_at = '2026-10-12T17:59:00.000Z', first_message_at = '2026-10-12T18:00:00.000Z', last_message_at = '2026-10-12T18:00:00.000Z'
       WHERE id = $1`,
      [fixture.conversationId],
    );
    await dataSource.query(
      `UPDATE lead_dealers
       SET created_at = '2026-10-12T18:01:00.000Z'
       WHERE lead_id = $1 AND dealer_id = $2`,
      [fixture.leadId, dealerId],
    );

    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-same-conversation-reengagement-${randomUUID()}`,
        occurred_at: '2026-10-13T18:00:00.000Z',
        message_body: `My number is ${testPhone} and I still want an SUV`,
        contact_phone: testPhone,
        contact_name: 'Same Conversation Buyer',
        channel: 'messenger',
      },
      source,
      { contactId: fixture.contactId, conversationId: fixture.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.status, ld.status AS dealer_status, ld.has_unhandled_reengagement, ld.reengagement_count,
              (SELECT COUNT(*)::int FROM leads WHERE canonical_phone = $1) AS lead_count,
              (SELECT COUNT(*)::int FROM conversations WHERE lead_id = $2) AS conversation_count,
              (SELECT COUNT(*)::int FROM conversation_bot_pause_events WHERE conversation_id = c.id) AS pause_event_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.id = $4`,
      [testPhone, fixture.leadId, dealerId, fixture.conversationId],
    ) as Array<{ status: string; dealer_status: string; has_unhandled_reengagement: boolean; reengagement_count: number; lead_count: number; conversation_count: number; pause_event_count: number }>;

    expect(rows).toEqual([{
      status: 'queued',
      dealer_status: 'pending',
      has_unhandled_reengagement: true,
      reengagement_count: 1,
      lead_count: 1,
      conversation_count: 1,
      pause_event_count: 1,
    }]);
  });

  it('marks only a conversation with old messages as reengagement without creating another lead', async () => {
    const fixture = await createLeadAndConversation({ name: 'Historical Buyer', phone: '+17712024964', status: 'queued', priorMessage: `My number is ${'+17712024964'} and I am looking for an SUV` });
    await dataSource.query(
      `UPDATE conversations
       SET created_at = '2026-10-12T17:59:00.000Z', first_message_at = '2026-10-12T18:00:00.000Z', last_message_at = '2026-10-12T18:00:00.000Z'
       WHERE id = $1`,
      [fixture.conversationId],
    );
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, vehicle_type, routing_status, status, message_text)
       VALUES ($1, $2, 'SUV', 'resolved', 'pending', 'Historical Buyer')`,
      [fixture.leadId, dealerId],
    );
    await dataSource.query(
      `UPDATE lead_dealers
       SET created_at = (SELECT created_at - INTERVAL '1 minute' FROM conversations WHERE id = $1)
       WHERE lead_id = $2 AND dealer_id = $3`,
      [fixture.conversationId, fixture.leadId, dealerId],
    );
    const currentConversation = await createConversationForLead({
      leadId: fixture.leadId,
      contactId: fixture.contactId,
      conversationKey: `classification-current-${randomUUID()}`,
      createdAt: '2026-10-13T18:00:00.000Z',
    });

    const result = await service.acceptCustomerReplied(
      { event_id: `evt-old-${fixture.contactId}`, occurred_at: '2026-10-13T18:00:00.000Z', message_body: `My number is ${fixture.phone} and I am still interested in an SUV`, contact_phone: fixture.phone, contact_name: 'Historical Buyer', channel: 'messenger' },
      source,
      { contactId: fixture.contactId, conversationId: currentConversation.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.status,
              (SELECT COUNT(*)::int FROM leads WHERE id = $1) AS lead_count,
              (SELECT COUNT(*)::int FROM conversations WHERE lead_id = $1) AS conversation_count,
              ld.status AS dealer_status, ld.has_unhandled_reengagement
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.id = $2`,
      [fixture.leadId, currentConversation.conversationId, dealerId],
    ) as Array<{ status: string; lead_count: number; conversation_count: number; dealer_status: string; has_unhandled_reengagement: boolean }>;

    expect(rows).toEqual([{ status: 'queued', lead_count: 1, conversation_count: 2, dealer_status: 'pending', has_unhandled_reengagement: true }]);
  });

  it('reuses a sent lead when a new GHL contact returns with the same name and phone', async () => {
    const phoneSuffix = String(Date.now() % 10_000).padStart(4, '0');
    const testPhone = `+1771202${phoneSuffix}`;
    const sentLead = await createSentLead({ name: 'Daniel Morales', phone: testPhone });
    const historicalConversation = await createConversationForLead({
      leadId: sentLead.leadId,
      contactId: sentLead.contactId,
      conversationKey: `sent-historical-${randomUUID()}`,
      createdAt: '2026-10-12T18:00:00.000Z',
      status: 'queued',
    });
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [historicalConversation.conversationId, `prior-${historicalConversation.conversationKey}`, `prior-message-${historicalConversation.conversationKey}`, `My number is ${testPhone} and I am looking for an SUV`, '2026-10-12T18:00:00.000Z'],
    );
    await dataSource.query(
      `UPDATE conversations
       SET status = 'queued', created_at = '2026-10-12T17:59:00.000Z', first_message_at = '2026-10-12T18:00:00.000Z', last_message_at = '2026-10-12T18:00:00.000Z'
       WHERE id = $1`,
      [historicalConversation.conversationId],
    );
    await dataSource.query(
      `UPDATE lead_dealers
       SET created_at = '2026-10-12T17:59:00.000Z'
       WHERE lead_id = $1 AND dealer_id = $2`,
      [sentLead.leadId, dealerId],
    );
    const firstReturn = await createConversationForLead({
      leadId: sentLead.leadId,
      contactId: sentLead.contactId,
      conversationKey: `sent-reengagement-${randomUUID()}`,
      createdAt: '2026-10-13T18:00:00.000Z',
    });
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
      { contactId: sentLead.contactId, conversationId: firstReturn.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    for (const attempt of [2, 3]) {
      const currentReturn = await createConversationForLead({
        leadId: sentLead.leadId,
        contactId: sentLead.contactId,
        conversationKey: `sent-reengagement-${randomUUID()}`,
        createdAt: `2026-10-${String(12 + attempt).padStart(2, '0')}T18:00:00.000Z`,
      });
      const repeatedResult = await service.acceptCustomerReplied(
        {
          event_id: `evt-sent-reengagement-${attempt}-${randomUUID()}`,
          occurred_at: `2026-10-${String(12 + attempt).padStart(2, '0')}T18:00:00.000Z`,
          message_body: `My number is ${sentLead.phone} and I still want an SUV${attempt === 3 ? ', please write me' : ''}`,
          contact_phone: sentLead.phone,
          contact_name: 'Daniel Morales',
          channel: 'messenger',
        },
        source,
        { contactId: sentLead.contactId, conversationId: currentReturn.conversationKey, testNow: new Date(`2026-10-${String(12 + attempt).padStart(2, '0')}T18:00:15.000Z`) },
      );
      expect(repeatedResult.status).toBe('processed');
    }

    const rows = await dataSource.query(
      `SELECT c.lead_id, MAX(c.status) AS status, MAX(ld.status) AS dealer_status, BOOL_OR(ld.has_unhandled_reengagement) AS has_unhandled_reengagement, MAX(ld.reengagement_count) AS reengagement_count,
              (SELECT COUNT(*)::int FROM leads WHERE canonical_phone = $1 AND first_name = 'Daniel') AS lead_count,
              COUNT(*)::int AS conversation_count,
              (SELECT COUNT(*)::int FROM conversation_bot_pause_events WHERE conversation_id IN (SELECT id FROM conversations WHERE lead_id = $2)) AS pause_event_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.lead_id = $2
       GROUP BY c.lead_id`,
      [sentLead.phone, sentLead.leadId, dealerId],
    ) as Array<{ lead_id: string; status: string; dealer_status: string; has_unhandled_reengagement: boolean; reengagement_count: number; lead_count: number; conversation_count: number; pause_event_count: number }>;

    expect(rows).toEqual([{
      lead_id: sentLead.leadId,
      status: 'queued',
      dealer_status: 'pending',
      has_unhandled_reengagement: true,
      reengagement_count: 3,
      lead_count: 1,
      conversation_count: 4,
      pause_event_count: 3,
    }]);
  });

  it('reuses a sent lead by phone when the returning contact name differs', async () => {
    const phoneSuffix = String((Date.now() + 5) % 10_000).padStart(4, '0');
    const testPhone = `+1771202${phoneSuffix}`;
    const sentLead = await createSentLead({ name: 'Miguel Canete', phone: testPhone });
    const historicalConversation = await createConversationForLead({
      leadId: sentLead.leadId,
      contactId: sentLead.contactId,
      conversationKey: `phone-only-historical-${randomUUID()}`,
      createdAt: '2026-10-12T18:00:00.000Z',
      status: 'queued',
    });
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [historicalConversation.conversationId, `prior-${historicalConversation.conversationKey}`, `prior-message-${historicalConversation.conversationKey}`, `My number is ${testPhone} and I am looking for an SUV`, '2026-10-12T18:00:00.000Z'],
    );
    await dataSource.query(
      `UPDATE conversations
       SET status = 'queued', created_at = '2026-10-12T17:59:00.000Z', first_message_at = '2026-10-12T18:00:00.000Z', last_message_at = '2026-10-12T18:00:00.000Z'
       WHERE id = $1`,
      [historicalConversation.conversationId],
    );
    await dataSource.query(
      `UPDATE lead_dealers
       SET created_at = '2026-10-12T17:59:00.000Z'
       WHERE lead_id = $1 AND dealer_id = $2`,
      [sentLead.leadId, dealerId],
    );
    const returningConversation = await createConversationForLead({
      leadId: sentLead.leadId,
      contactId: sentLead.contactId,
      conversationKey: `phone-only-returning-${randomUUID()}`,
      createdAt: '2026-10-13T18:00:00.000Z',
    });

    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-phone-only-reengagement-${randomUUID()}`,
        occurred_at: '2026-10-13T18:00:00.000Z',
        message_body: `My number is ${testPhone}`,
        contact_phone: testPhone,
        contact_name: 'Wrong Contact Name',
        channel: 'messenger',
      },
      source,
      { contactId: sentLead.contactId, conversationId: returningConversation.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.status, ld.status AS dealer_status, ld.has_unhandled_reengagement, ld.reengagement_count,
              l.first_name, l.last_name,
              (SELECT COUNT(*)::int
               FROM leads
               WHERE first_name = 'Jason'
                 AND last_name = 'Carpenter'
                 AND source = 'reengagement-alias-regression') AS lead_count
       FROM conversations c
       INNER JOIN leads l ON l.id = c.lead_id
       INNER JOIN lead_dealers ld ON ld.lead_id = l.id AND ld.dealer_id = $2
       WHERE c.id = $3`,
      [testPhone, dealerId, returningConversation.conversationId],
    ) as Array<{ status: string; dealer_status: string; has_unhandled_reengagement: boolean; reengagement_count: number; first_name: string; last_name: string; lead_count: number }>;

    expect(rows).toEqual([{
      status: 'queued',
      dealer_status: 'pending',
      has_unhandled_reengagement: true,
      reengagement_count: 1,
      first_name: 'Miguel',
      last_name: 'Canete',
      lead_count: 1,
    }]);
  });

  it('reuses a historical lead from a location alias when its canonical phone is missing', async () => {
    const phone = `+154055${String((Date.now() + 7) % 100000).padStart(5, '0')}`;
    const oldContactId = `fred-alias-old-contact-${randomUUID()}`;
    const oldConversationKey = `fred-alias-old-conversation-${randomUUID()}`;
    const currentContactId = `fred-alias-current-contact-${randomUUID()}`;
    const currentConversationKey = `fred-alias-current-conversation-${randomUUID()}`;
    const fredLocationId = 'bAuMEQeH48xAtu9tAMFf';
    const currentLocationId = GHL_SOURCE_CONFIG.fredericksburg.locationId;
    const fredDealers = await dataSource.query(
      `SELECT d.id
       FROM dealers d
       WHERE d.active = true
         AND (d.ghl_location_id = $1 OR EXISTS (
           SELECT 1 FROM dealer_location_aliases a WHERE a.ghl_location_id = $1 AND a.dealer_id = d.id
         ))
       LIMIT 1`,
      [currentLocationId],
    ) as Array<{ id: string }>;
    if (!fredDealers[0]) throw new Error('No active Offlease Fredericksburg dealer configured for alias regression');

    const oldLeadRows = await dataSource.query(
      `INSERT INTO leads (canonical_phone, first_name, last_name, ghl_contact_id, ghl_location_id, source)
       VALUES (NULL, 'Jason', 'Carpenter', $1, $2, 'reengagement-alias-regression')
       RETURNING id`,
      [oldContactId, fredLocationId],
    ) as Array<{ id: string }>;
    const oldLeadId = oldLeadRows[0].id;
    createdLeadIds.push(oldLeadId);

    const oldConversationRows = await dataSource.query(
      `INSERT INTO conversations
        (lead_id, ghl_location_id, ghl_contact_id, ghl_conversation_id, channel, status,
         created_at, first_message_at, last_message_at, qualification_snapshot)
       VALUES ($1, $2, $3, $4, 'messenger', 'sent', '2026-10-14T18:00:00.000Z',
         '2026-10-14T18:00:00.000Z', '2026-10-14T18:05:00.000Z', $5::jsonb)
       RETURNING id`,
      [oldLeadId, fredLocationId, oldContactId, oldConversationKey, JSON.stringify({ phone, real_name: 'Jason Carpenter', vehicle_type: 'SUV' })],
    ) as Array<{ id: string }>;
    const oldConversationId = oldConversationRows[0].id;
    createdConversationIds.push(oldConversationId);
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at)
       VALUES ($1, $2, $3, $4, '2026-10-14T18:05:00.000Z')`,
      [oldConversationId, `fred-alias-prior-${oldConversationKey}`, `fred-alias-prior-message-${oldConversationKey}`, `My number is ${phone} and I am looking for an SUV`],
    );
    await dataSource.query(
      `INSERT INTO lead_dealers (lead_id, dealer_id, vehicle_type, routing_status, status, sent_at, message_text)
       VALUES ($1, $2, 'SUV', 'resolved', 'sent', '2026-10-14T18:10:00.000Z', 'Jason Carpenter')`,
      [oldLeadId, fredDealers[0].id],
    );

    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-fred-alias-reengagement-${randomUUID()}`,
        occurred_at: '2026-10-18T18:00:00.000Z',
        message_body: `My number is ${phone} and I still want an SUV`,
        contact_phone: phone,
        contact_name: 'Jason Carpenter',
        channel: 'messenger',
      },
      'fredericksburg',
      { contactId: currentContactId, conversationId: currentConversationKey, testNow: new Date('2026-10-18T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const currentConversationRows = await dataSource.query(
      `SELECT id FROM conversations WHERE ghl_conversation_id = $1`,
      [currentConversationKey],
    ) as Array<{ id: string }>;
    if (currentConversationRows[0]) createdConversationIds.push(currentConversationRows[0].id);

    const rows = await dataSource.query(
      `SELECT c.lead_id, c.status, ld.status AS dealer_status,
              ld.has_unhandled_reengagement, ld.reengagement_count,
              (SELECT COUNT(*)::int
               FROM leads
               WHERE first_name = 'Jason'
                 AND last_name = 'Carpenter'
                 AND source = 'reengagement-alias-regression') AS lead_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $1
       WHERE c.ghl_conversation_id = $2`,
      [fredDealers[0].id, currentConversationKey],
    ) as Array<{ lead_id: string; status: string; dealer_status: string; has_unhandled_reengagement: boolean; reengagement_count: number; lead_count: number }>;

    expect(rows).toEqual([{
      lead_id: oldLeadId,
      status: 'queued',
      dealer_status: 'pending',
      has_unhandled_reengagement: true,
      reengagement_count: 1,
      lead_count: 1,
    }]);
    expect(currentLocationId).not.toBe(fredLocationId);
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

  it('keeps a manually entered lead when the same conversation returns after 24 hours', async () => {
    const phoneSuffix = String((Date.now() + 4) % 10_000).padStart(4, '0');
    const testPhone = `+1771202${phoneSuffix}`;
    const sentLead = await createSentLead({ name: 'Manual Same Conversation', phone: testPhone });
    const conversation = await createConversationForLead({
      leadId: sentLead.leadId,
      contactId: sentLead.contactId,
      conversationKey: `manual-same-conversation-${randomUUID()}`,
      createdAt: '2026-10-12T18:00:00.000Z',
      status: 'queued',
    });
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, dedupe_key, ghl_message_id, body, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversation.conversationId, `manual-prior-${conversation.conversationKey}`, `manual-prior-message-${conversation.conversationKey}`, `My number is ${testPhone} and I am looking for an SUV`, '2026-10-12T18:00:00.000Z'],
    );
    await dataSource.query(
      `UPDATE lead_dealers
       SET created_at = '2026-10-12T17:59:00.000Z'
       WHERE lead_id = $1 AND dealer_id = $2`,
      [sentLead.leadId, dealerId],
    );

    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-manual-same-conversation-${randomUUID()}`,
        occurred_at: '2026-10-13T18:00:00.000Z',
        message_body: `My number is ${testPhone} and I still want an SUV`,
        contact_phone: testPhone,
        contact_name: 'Manual Same Conversation',
        channel: 'messenger',
      },
      source,
      { contactId: sentLead.contactId, conversationId: conversation.conversationKey, testNow: new Date('2026-10-13T18:00:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.lead_id, c.status, ld.status AS dealer_status, ld.has_unhandled_reengagement, ld.reengagement_count,
              (SELECT COUNT(*)::int FROM leads WHERE canonical_phone = $1 AND first_name = 'Manual') AS lead_count,
              (SELECT COUNT(*)::int FROM conversations WHERE lead_id = $2) AS conversation_count,
              (SELECT COUNT(*)::int FROM conversation_bot_pause_events WHERE conversation_id = c.id) AS pause_event_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.id = $4`,
      [testPhone, sentLead.leadId, dealerId, conversation.conversationId],
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

  it('reuses the manual lead when an old queued conversation lost its dealer relationship', async () => {
    const phoneSuffix = String((Date.now() + 2) % 10_000).padStart(4, '0');
    const testPhone = `+1771202${phoneSuffix}`;
    const historical = await createLeadAndConversation({
      name: 'Agustin Galicia',
      phone: testPhone,
      status: 'queued',
      priorMessage: `My number is ${testPhone} and I am looking for a truck`,
    });
    const manualLead = await createSentLead({ name: 'Agustin Galicia', phone: testPhone, status: 'pending' });
    await dataSource.query('DELETE FROM lead_dealers WHERE lead_id = $1', [historical.leadId]);

    const result = await service.acceptCustomerReplied(
      {
        event_id: `evt-orphaned-queued-${randomUUID()}`,
        occurred_at: '2026-10-13T18:45:00.000Z',
        message_body: 'Sigo interesado en la camioneta',
        contact_phone: testPhone,
        contact_name: 'Agustin Galicia',
        channel: 'messenger',
      },
      source,
      { contactId: historical.contactId, conversationId: historical.conversationKey, testNow: new Date('2026-10-13T18:45:15.000Z') },
    );
    expect(result.status).toBe('processed');

    const rows = await dataSource.query(
      `SELECT c.lead_id, c.status, ld.status AS dealer_status, ld.has_unhandled_reengagement, ld.reengagement_count,
              (SELECT COUNT(*)::int FROM leads WHERE canonical_phone = $1) AS lead_count,
              (SELECT COUNT(*)::int FROM conversations WHERE lead_id = $2) AS conversation_count,
              (SELECT COUNT(*)::int FROM conversation_bot_pause_events WHERE conversation_id = c.id) AS pause_event_count
       FROM conversations c
       INNER JOIN lead_dealers ld ON ld.lead_id = c.lead_id AND ld.dealer_id = $3
       WHERE c.id = $4`,
      [testPhone, manualLead.leadId, dealerId, historical.conversationId],
    ) as Array<{ lead_id: string; status: string; dealer_status: string; has_unhandled_reengagement: boolean; reengagement_count: number; lead_count: number; conversation_count: number; pause_event_count: number }>;

    expect(rows).toEqual([{
      lead_id: manualLead.leadId,
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
