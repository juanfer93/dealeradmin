import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';

const databaseUrl = process.env.EASTERN_REAL_NAME_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;
const replay = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/easterns-juiccy-zayy-replay.json'), 'utf8')) as {
  source: string;
  channel: string;
  contact_name: string;
  messages: string[];
};

describeDatabase('Easterns real-name production replay', () => {
  let dataSource: DataSource;
  const suffix = `easterns-real-name-replay-${Date.now()}`;
  const contactId = `${suffix}-contact`;
  const conversationId = `${suffix}-conversation`;
  const latestVehicleSuffix = `latest-vehicle-replay-${Date.now()}`;
  const latestVehicleContacts = [
    `${latestVehicleSuffix}-stafford-contact`,
    `${latestVehicleSuffix}-fredericksburg-contact`,
  ];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('EASTERN_REAL_NAME_DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const testContactId of [contactId, ...latestVehicleContacts]) {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [testContactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [testContactId]);
      await dataSource.query(
        `DELETE FROM conversations
         WHERE ghl_contact_id = $1
            OR lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)`,
        [testContactId],
      );
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [testContactId]);
    }
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1 OR event_id LIKE $2', [`${suffix}-%`, `${latestVehicleSuffix}-%`]);
    await dataSource.destroy();
  });

  it('keeps Juiccy Zayy instead of promoting the first vehicle-intent message', async () => {
    const service = new ConversationWebhookService(dataSource);

    for (const [index, message] of replay.messages.entries()) {
      const eventId = `${suffix}-${index}`;
      await service.acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel: replay.channel,
        contact_name: replay.contact_name,
        contact_phone: '',
        message_body: message,
        occurred_at: `2026-09-23T11:${String(index).padStart(2, '0')}:00.000Z`,
      }, replay.source, { contactId, conversationId, messageId: `${eventId}-message` });
    }

    const rows = await dataSource.query(
      `SELECT l.first_name, l.last_name, c.qualification_snapshot
       FROM conversations c
       JOIN leads l ON l.id = c.lead_id
       WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $2`,
      [contactId, conversationId],
    ) as Array<{ first_name: string; last_name: string; qualification_snapshot: Record<string, unknown> }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ first_name: 'Juiccy', last_name: 'Zayy' });
    expect(rows[0].qualification_snapshot).toMatchObject({ real_name: 'Juiccy Zayy', vehicle_type: 'SUV' });
    expect(JSON.stringify(rows[0].qualification_snapshot)).not.toContain('Need A Vehicle Fast');
  }, 20_000);

  it('replays the vehicle change for Stafford WhatsApp and Fredericksburg Messenger in local PostgreSQL', async () => {
    const service = new ConversationWebhookService(dataSource);
    const scenarios = [
      {
        source: 'stafford',
        channel: 'whatsapp',
        contactId: latestVehicleContacts[0],
        conversationId: `${latestVehicleSuffix}-stafford-conversation`,
        contactPhone: '+19107093650',
        messages: ['Juan Jose Castillo', 'Estoy interesado en una Honda CRV 2014', 'O un Honda Civic 2012', 'Un sedan', '1500'],
      },
      {
        source: 'fredericksburg',
        channel: 'messenger',
        contactId: latestVehicleContacts[1],
        conversationId: `${latestVehicleSuffix}-fredericksburg-conversation`,
        contactPhone: '',
        messages: ['Juan Jose Castillo', 'Estoy interesado en una Honda CRV 2014', 'O un Honda Civic 2012', 'Un sedan', '804-970-1204', 'Tengo 1500 para el down'],
      },
    ];

    for (const scenario of scenarios) {
      for (const [index, message] of scenario.messages.entries()) {
        const eventId = `${latestVehicleSuffix}-${scenario.source}-${index}`;
        await service.acceptCustomerReplied({
          event_id: eventId,
          ghl_message_id: `${eventId}-message`,
          ghl_contact_id: scenario.contactId,
          ghl_conversation_id: scenario.conversationId,
          channel: scenario.channel,
          contact_name: 'Juan Jose Castillo',
          contact_phone: scenario.contactPhone,
          message_body: message,
          occurred_at: `2026-09-23T12:${String(index).padStart(2, '0')}:00.000Z`,
        }, scenario.source, {
          contactId: scenario.contactId,
          conversationId: scenario.conversationId,
          messageId: `${eventId}-message`,
        });
      }
    }

    const rows = await dataSource.query(
      `SELECT c.ghl_contact_id, c.qualification_snapshot
       FROM conversations c
       WHERE c.ghl_contact_id = ANY($1::text[])
       ORDER BY c.ghl_contact_id`,
      [latestVehicleContacts],
    ) as Array<{ ghl_contact_id: string; qualification_snapshot: Record<string, unknown> }>;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.qualification_snapshot).toMatchObject({
        real_name: 'Juan Jose Castillo',
        vehicle_type: 'sedan',
        down_payment: '1500',
        required_down_payment: 1500,
        down_payment_sufficient: true,
      });
    }
    expect(rows.find((row) => row.ghl_contact_id.endsWith('fredericksburg-contact'))?.qualification_snapshot).toMatchObject({
      phone: '+18049701204',
    });
  }, 20_000);
});
