import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';

const databaseUrl = process.env.VEHICLE_YEAR_DOWN_LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('vehicle year and down payment separation against local PostgreSQL', () => {
  let dataSource: DataSource;
  const suffix = `vehicle-year-down-qa-${Date.now()}`;
  const cases = [
    { name: 'vehicle year only', body: 'Me interesa la F150 2018', year: 2018, down: '' },
    { name: 'vehicle year plus explicit down', body: 'Quiero el Honda Civic 2020 y tengo 2500 de down', year: 2020, down: '2500' },
    { name: 'Spanish intermediate down', body: 'Tengo 1800 para dar de cuota inicial', year: null, down: '1800' },
    { name: 'vehicle year plus second down', body: 'Busco carro 2008 con 2000 down', year: 2008, down: '2000' },
  ] as const;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('VEHICLE_YEAR_DOWN_LOCAL_DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id LIKE $1', [`${suffix}-%`]);
    await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)', [`${suffix}-%`]);
    await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id LIKE $1', [`${suffix}-%`]);
    await dataSource.query('DELETE FROM leads WHERE ghl_contact_id LIKE $1', [`${suffix}-%`]);
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-%`]);
    await dataSource.destroy();
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))('persists $name with separate year/down fields', async ({ body, year, down, index }) => {
    const contactId = `${suffix}-${index}-contact`;
    const conversationId = `${suffix}-${index}-conversation`;
    const eventId = `${suffix}-${index}-message`;
    const phone = `+1540555${String(1000 + index).padStart(4, '0')}`;
    await new ConversationWebhookService(dataSource).acceptCustomerReplied({
      event_id: eventId,
      ghl_message_id: `${eventId}-ghl`,
      ghl_contact_id: contactId,
      ghl_conversation_id: conversationId,
      channel: 'messenger',
      contact_name: `Year Down QA ${index}`,
      contact_phone: phone,
      message_body: body,
      occurred_at: `2026-09-29T15:0${index}:00.000Z`,
    }, 'fredericksburg-2', { contactId, conversationId, messageId: `${eventId}-ghl` });

    const rows = await dataSource.query(
      `SELECT qualification_snapshot FROM conversations WHERE ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ qualification_snapshot: Record<string, unknown> }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].qualification_snapshot).toMatchObject({
      vehicle_year: year,
      down_payment: down,
      down_payment_amount: down ? Number(down) : null,
    });
  });
});
