import { readFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../apps/api/src/features/webhooks/application/conversation-webhook.service';
import { normalizeCollectorInput } from '../../apps/api/src/features/leads/domain/collector-normalizer';

const fixture = JSON.parse(readFileSync(new URL('./rafael-production-fixture.json', import.meta.url), 'utf8')) as {
  conversation: { ghl_location_id: string; ghl_contact_id: string; ghl_conversation_id: string };
  messages: Array<{ direction: string; body: string; occurred_at: string }>;
};

const databaseUrl = process.env.RAFAEL_LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('Rafael production fixture against local PostgreSQL', () => {
  let dataSource: DataSource;
  let dealerId: string;
  const suffix = `rafael-qa-${Date.now()}`;
  const contactId = `${suffix}-contact`;
  const conversationId = `${suffix}-conversation`;
  const eventIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
    const dealer = await dataSource.query(
      `INSERT INTO dealers (code, name, ghl_location_id, timezone, routing_config, active)
       VALUES ($1, $2, $3, 'America/New_York', '{}'::jsonb, true) RETURNING id`,
      [`QA-${suffix}`, 'QA Offlease Fredericksburg', fixture.conversation.ghl_location_id],
    ) as Array<{ id: string }>;
    dealerId = dealer[0].id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(`DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1`, [contactId]);
    await dataSource.query(`DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)`, [contactId]);
    await dataSource.query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ghl_contact_id = $1)`, [contactId]);
    await dataSource.query(`DELETE FROM conversations WHERE ghl_contact_id = $1`, [contactId]);
    await dataSource.query(`DELETE FROM leads WHERE ghl_contact_id = $1`, [contactId]);
    await dataSource.query(`DELETE FROM webhook_events WHERE event_id = ANY($1::varchar[])`, [eventIds]);
    await dataSource.query(`DELETE FROM dealers WHERE id = $1`, [dealerId]);
    await dataSource.destroy();
  });

  it('normalizes the copied conversation and persists waiting_window with 2000', async () => {
    const inbound = fixture.messages.filter((message) => message.direction === 'inbound');
    const transcript = inbound.map((message) => message.body).join('\n');
    const normalized = normalizeCollectorInput({
      source: 'fredericksburg',
      channel: fixture.conversation.ghl_conversation_id.endsWith(':messenger') ? 'messenger' : 'messenger',
      real_name: 'Rafael Araque',
      phone: '+18644842725',
      message: inbound.at(-1)?.body,
      chat_history_log: transcript,
    });
    expect(normalized).toMatchObject({
      vehicle_type: 'Suv',
      down_payment: '2000',
      down_payment_amount: 2000,
      required_down_payment: 2000,
      down_payment_sufficient: true,
      qualification_step: 'purchase_timeline',
    });

    const service = new ConversationWebhookService(dataSource);
    for (const [index, message] of inbound.entries()) {
      const eventId = `${suffix}-event-${index}`;
      eventIds.push(eventId);
      await service.acceptCustomerReplied({
        event_id: eventId,
        event_type: 'CustomerReplied',
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel: 'messenger',
        message_body: message.body,
        contact_name: 'Rafael Araque',
        contact_phone: message.body.includes('8644842725') ? '+18644842725' : '',
        occurred_at: message.occurred_at,
      }, 'fredericksburg', { contactId, conversationId, messageId: `${eventId}-message` });
    }

    const rows = await dataSource.query(
      `SELECT status, qualification_snapshot FROM conversations WHERE ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'waiting_window' });
    expect(rows[0].qualification_snapshot).toMatchObject({
      down_payment: '2000',
      down_payment_amount: 2000,
      down_payment_sufficient: true,
      required_down_payment: 2000,
    });
    expect(await dataSource.query(
      `SELECT down_payment FROM lead_dealers WHERE lead_id = (SELECT lead_id FROM conversations WHERE ghl_contact_id = $1) AND dealer_id = $2`,
      [contactId, dealerId],
    )).toEqual([]);
  });
});
