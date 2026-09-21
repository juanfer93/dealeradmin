import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';

const databaseUrl = process.env.SUGGESTED_DOWN_LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('contextual suggested down confirmation against local PostgreSQL', () => {
  let dataSource: DataSource;
  const suffix = `suggested-down-qa-${Date.now()}`;
  const cases = [
    { vehicle: 'Sedan', reply: 'Con ese monto', minimum: 1500 },
    { vehicle: 'SUV', reply: 'Con este monto', minimum: 2000 },
    { vehicle: 'van', reply: 'Ese monto sí lo tengo', minimum: 2000 },
    { vehicle: 'minivan', reply: 'Con esa cantidad está bien', minimum: 2000 },
    { vehicle: 'Toyota Tacoma', reply: 'Con ese monto', minimum: 3000 },
  ] as const;
  const contacts = cases.map((_, index) => `${suffix}-${index}-contact`);
  const conversations = cases.map((_, index) => `${suffix}-${index}-conversation`);
  const staffordContacts = cases.map((_, index) => `${suffix}-stafford-${index}-contact`);
  const staffordConversations = cases.map((_, index) => `${suffix}-stafford-${index}-conversation`);

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('SUGGESTED_DOWN_LOCAL_DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const contactId of [...contacts, ...staffordContacts]) {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
    }
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-%`]);
    await dataSource.destroy();
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))('normalizes "$reply" as the suggested $minimum down for $vehicle and persists waiting_window', async ({ vehicle, reply, minimum, index }) => {
    const contactId = contacts[index];
    const conversationId = conversations[index];
    const phone = `+1540555${String(1000 + index).padStart(4, '0')}`;
    const send = async (step: string, body: string, contactPhone = '') => {
      const eventId = `${suffix}-${index}-${step}`;
      await new ConversationWebhookService(dataSource).acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel: 'messenger',
        contact_name: `Suggested Down ${index}`,
        contact_phone: contactPhone,
        message_body: body,
        occurred_at: `2026-09-19T14:${String(30 + index).padStart(2, '0')}:00.000Z`,
      }, 'fredericksburg-2', { contactId, conversationId, messageId: `${eventId}-message` });
    };

    await send('vehicle', `Busco una ${vehicle}`);
    await send('phone', phone, phone);
    await send('confirmation', reply);

    const rows = await dataSource.query(
      `SELECT status, qualification_snapshot FROM conversations WHERE ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown> }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'waiting_window' });
    expect(rows[0].qualification_snapshot).toMatchObject({
      down_payment: String(minimum),
      down_payment_amount: minimum,
      required_down_payment: minimum,
      down_payment_sufficient: true,
    });
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))('applies the same contextual confirmation in Stafford WhatsApp for $vehicle', async ({ vehicle, reply, minimum, index }) => {
    const contactId = staffordContacts[index];
    const conversationId = staffordConversations[index];
    const phone = `+1571835${String(1600 + index)}`;
    const send = async (step: string, body: string) => {
      const eventId = `${suffix}-stafford-${index}-${step}`;
      await new ConversationWebhookService(dataSource).acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel: 'whatsapp',
        contact_name: `Suggested Down Stafford ${index}`,
        contact_phone: phone,
        message_body: body,
        occurred_at: `2026-09-19T14:${String(50 + index).padStart(2, '0')}:00.000Z`,
      }, 'stafford', { contactId, conversationId, messageId: `${eventId}-message` });
    };

    await send('name', 'Nelson Silva');
    await send('vehicle', `Busco una ${vehicle}`);
    await send('confirmation', reply);

    const rows = await dataSource.query(
      `SELECT status, qualification_snapshot FROM conversations WHERE ghl_contact_id = $1`,
      [contactId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown> }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'waiting_window' });
    expect(rows[0].qualification_snapshot).toMatchObject({
      phone,
      down_payment: String(minimum),
      down_payment_amount: minimum,
      required_down_payment: minimum,
      down_payment_sufficient: true,
    });
  });
});

describeDatabase('Offlease previous-financing promotion against local PostgreSQL', () => {
  let dataSource: DataSource;
  const suffix = `promo-financing-qa-${Date.now()}`;
  const question = 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?';
  const cases = [
    { source: 'stafford', channel: 'whatsapp', vehicle: 'Sedan', answer: 'Sí' },
    { source: 'stafford', channel: 'whatsapp', vehicle: 'SUV', answer: 'Sí, ya financié antes' },
    { source: 'stafford', channel: 'whatsapp', vehicle: 'van', answer: 'Yes, I financed a vehicle before' },
    { source: 'stafford', channel: 'whatsapp', vehicle: 'Toyota Tacoma', answer: 'Claro' },
    { source: 'stafford', channel: 'whatsapp', vehicle: 'minivan', answer: 'I have financed before' },
    { source: 'fredericksburg', channel: 'messenger', vehicle: 'Toyota Tacoma', answer: 'Sí' },
    { source: 'fredericksburg', channel: 'messenger', vehicle: 'Silverado', answer: 'Sí, anteriormente financié un vehículo' },
    { source: 'fredericksburg', channel: 'messenger', vehicle: 'family van', answer: 'Yes, I financed a car before' },
    { source: 'fredericksburg', channel: 'messenger', vehicle: 'Honda Civic', answer: 'Claro' },
    { source: 'fredericksburg', channel: 'messenger', vehicle: 'SUV', answer: 'I have financed before' },
  ] as const;
  const negativeCases = [
    { source: 'stafford', channel: 'whatsapp', vehicle: 'Sedan', answer: 'No', minimum: 1500 },
    { source: 'stafford', channel: 'whatsapp', vehicle: 'van', answer: 'No tengo historial de financiamiento', minimum: 2000 },
    { source: 'fredericksburg', channel: 'messenger', vehicle: 'Toyota Tacoma', answer: 'Nunca he financiado', minimum: 3000 },
    { source: 'fredericksburg', channel: 'messenger', vehicle: 'Silverado', answer: 'No, nunca', minimum: 3000 },
  ] as const;
  const contacts = cases.map((_, index) => `${suffix}-${index}-contact`);

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('SUGGESTED_DOWN_LOCAL_DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const contactId of contacts) {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
    }
    await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id LIKE $1', [`${suffix}-negative-%`]);
    await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id LIKE $1)', [`${suffix}-negative-%`]);
    await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id LIKE $1', [`${suffix}-negative-%`]);
    await dataSource.query('DELETE FROM leads WHERE ghl_contact_id LIKE $1', [`${suffix}-negative-%`]);
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-%`]);
    await dataSource.destroy();
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))('accepts $1000 after the financing-history question for $source/$vehicle and enters waiting_window', async ({ source, channel, vehicle, answer, index }) => {
    const contactId = contacts[index];
    const conversationId = `${suffix}-${index}-conversation`;
    const phone = `+1540555${String(7000 + index).padStart(4, '0')}`;
    const send = async (step: string, body: string) => {
      const eventId = `${suffix}-${index}-${step}`;
      await new ConversationWebhookService(dataSource).acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel,
        contact_name: channel === 'messenger' ? `Promo Buyer ${index}` : `Promo Buyer ${index}`,
        contact_phone: phone,
        message_body: body,
        occurred_at: `2026-09-19T15:${String(index).padStart(2, '0')}:00.000Z`,
      }, source, { contactId, conversationId, messageId: `${eventId}-message` });
    };

    if (channel === 'whatsapp') await send('name', 'Carlos');
    await send('vehicle-and-down', `Busco una ${vehicle} y tengo 1000 de down`);
    if (channel === 'messenger') await send('phone', phone);
    const beforeAnswer = await dataSource.query(
      `SELECT qualification_snapshot FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2`,
      [contactId, conversationId],
    ) as Array<{ qualification_snapshot: { qualification_progress?: { predicted_bot_question?: string } } }>;
    expect(String(beforeAnswer[0]?.qualification_snapshot.qualification_progress?.predicted_bot_question)).toBe(question);
    await send('financing-history-answer', answer);

    const rows = await dataSource.query(
      `SELECT status, qualification_snapshot FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2`,
      [contactId, conversationId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'waiting_window' });
    expect(rows[0].qualification_snapshot).toMatchObject({
      previous_financing: 'yes',
      down_payment: '1000',
      down_payment_amount: 1000,
      down_payment_sufficient: true,
      required_down_payment: expect.any(Number),
    });
  });

  it.each(negativeCases.map((testCase, index) => ({ ...testCase, index })))('keeps the regular $minimum down requirement after a negative financing-history answer for $source/$vehicle', async ({ source, channel, vehicle, answer, minimum, index }) => {
    const contactId = `${suffix}-negative-${index}-contact`;
    const conversationId = `${suffix}-negative-${index}-conversation`;
    const phone = `+1540666${String(7000 + index).padStart(4, '0')}`;
    const send = async (step: string, body: string) => {
      const eventId = `${suffix}-negative-${index}-${step}`;
      await new ConversationWebhookService(dataSource).acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel,
        contact_name: `Negative Promo Buyer ${index}`,
        contact_phone: phone,
        message_body: body,
        occurred_at: `2026-09-19T16:${String(index).padStart(2, '0')}:00.000Z`,
      }, source, { contactId, conversationId, messageId: `${eventId}-message` });
    };

    if (channel === 'whatsapp') await send('name', 'Carlos');
    await send('vehicle-and-down', `Busco una ${vehicle} y tengo 1000 de down`);
    if (channel === 'messenger') await send('phone', phone);
    const beforeAnswer = await dataSource.query(
      `SELECT qualification_snapshot FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2`,
      [contactId, conversationId],
    ) as Array<{ qualification_snapshot: { qualification_progress?: { predicted_bot_question?: string } } }>;
    expect(String(beforeAnswer[0]?.qualification_snapshot.qualification_progress?.predicted_bot_question)).toBe(question);
    await send('financing-history-answer', answer);

    const rows = await dataSource.query(
      `SELECT status, qualification_snapshot FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2`,
      [contactId, conversationId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'partial' });
    expect(rows[0].qualification_snapshot).toMatchObject({
      previous_financing: 'no',
      down_payment: '1000',
      down_payment_amount: 1000,
      down_payment_sufficient: false,
      required_down_payment: minimum,
      missing_qualification: expect.arrayContaining(['down_payment_minimum']),
    });
    expect(String((rows[0].qualification_snapshot.qualification_progress as { predicted_bot_question?: string }).predicted_bot_question)).toContain(`$${minimum}`);
    await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [contactId]);
    await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
    await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [contactId]);
    await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
  });
});
