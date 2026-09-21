import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';

const databaseUrl = process.env.SUGGESTED_DOWN_LOCAL_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

describeDatabase('historical Offlease transcript replay from production audit', () => {
  let dataSource: DataSource;
  const suffix = `historical-offlease-audit-${Date.now()}`;

  const cases = [
    {
      label: 'Fredericksburg 2 / Alexander Escobar / positive regular minimum',
      source: 'fredericksburg-2',
      channel: 'messenger',
      contactName: 'Alexander Escobar',
      phone: '+18042216321',
      messages: [
        'Buenas tardes ustedes financean no es con banco ?',
        'Sedan',
        'Civic sport',
        '8042216321',
        '2000',
      ],
      expected: { vehicle: 'Civic sport', down: '2000', amount: 2000, minimum: 1500, sufficient: true, nextStep: 'complete' },
    },
    {
      label: 'Fredericksburg 2 / Angel Fuentes / negative misspelled truck',
      source: 'fredericksburg-2',
      channel: 'messenger',
      contactName: 'Angel Fuentes',
      phone: '',
      messages: [
        'Buenas tardes. K requisitos pides para fonanciar una troca?',
        'Solo cuento con $1700 ahora',
        'Lo Maximo k puedo aseguran son $2000',
        'Esta bien. Gracias',
      ],
      expected: { vehicle: 'truck', down: '2000', amount: 2000, minimum: 3000, sufficient: false, nextStep: 'phone' },
    },
    {
      label: 'Stafford / Rosa / positive suggested SUV minimum with misspellings',
      source: 'stafford',
      channel: 'whatsapp',
      contactName: 'Rosa',
      phone: '+12405551234',
      messages: [
        '*Headline:* Off Lease Motors Of Stafford\n*Source URL:* https://fb.me/49eeKTmwE\n\nHello! Can I get more info on this? Hola',
        'Hola soy rosa en que estado te encuentras',
        'Yo en greesboro nc',
        'Si algo asi como suv',
        'Aceptan itin y pasaporte y un estado de cuenta',
        'Y pues te soy sinsera yo no tengo credito porque el credito selo dado a otras personas',
        'Orita no cuento con mucho pero no quiero un carro muy carro cunto como 1500 a 2000',
        'Si 2000 esta bien',
        'Pues yo ari los pagos y mi hija pondría aseguransa',
        'Si sepuede asi',
        'Este fin de semana megustsria ir ber',
        'Me manda su ubicación',
        'Si tengo mi pasaporte',
        'Si tengo wlfargo',
        'Dise que solo este mes mes mire mejor boy aser una Sita con usted mejor para la otra semana esta no para la otra a tes de que pase el mes',
        'Si grasias aqui mismo',
      ],
      expected: { vehicle: 'suv', down: '2000', amount: 2000, minimum: 2000, sufficient: true, nextStep: 'complete' },
    },
    {
      label: 'Stafford / Eduardo / negative unrelated affirmation',
      source: 'stafford',
      channel: 'whatsapp',
      contactName: 'Eduardo',
      phone: '+18623042441',
      messages: [
        '*Headline:* Financiamiento interno!\n*Source URL:* https://fb.me/cUWAq5MPm\n\nTengo el downpayment listo !',
        'Eduardo',
        'Donde estan ubicados ustedes disculpe',
        'Carro normal',
        'Pero en que estado estan ubicados',
        '1500',
        'Mandeme la dirección',
        'Y me reciben un carro también',
        'Yo si quiero un carro',
        'Pero no tengo crédito ni licencia',
        'Si esta bien',
        'Este mes',
        'Ok.',
        'Ok',
      ],
      expected: { vehicle: 'Quiere hablar con un asesor', down: '1500', amount: 1500, minimum: null, sufficient: false, nextStep: 'vehicle_type' },
    },
  ] as const;

  const ids = cases.map((_, index) => ({
    contactId: `${suffix}-${index}-contact`,
    conversationId: `${suffix}-${index}-conversation`,
  }));

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('SUGGESTED_DOWN_LOCAL_DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const { contactId } of ids) {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query(
        `DELETE FROM conversations
         WHERE ghl_contact_id = $1
            OR lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)`,
        [contactId],
      );
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
    }
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-%`]);
    await dataSource.destroy();
  });

  it.each(cases.map((testCase, index) => ({ ...testCase, index })))('$label replays with current normalization rules', async ({ source, channel, contactName, phone, messages, expected, index }) => {
    const { contactId, conversationId } = ids[index];
    const service = new ConversationWebhookService(dataSource);
    for (const [messageIndex, message] of messages.entries()) {
      const eventId = `${suffix}-${index}-${messageIndex}`;
      await service.acceptCustomerReplied({
        event_id: eventId,
        ghl_message_id: `${eventId}-message`,
        ghl_contact_id: contactId,
        ghl_conversation_id: conversationId,
        channel,
        contact_name: contactName,
        contact_phone: messageIndex === 0 ? phone : '',
        message_body: message,
        occurred_at: `2026-09-19T${String(10 + index).padStart(2, '0')}:${String(messageIndex).padStart(2, '0')}:00.000Z`,
      }, source, { contactId, conversationId, messageId: `${eventId}-message` });
    }

    const rows = await dataSource.query(
      'SELECT status, qualification_snapshot FROM conversations WHERE ghl_contact_id = $1 AND ghl_conversation_id = $2',
      [contactId, conversationId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown> }>;

    expect(rows).toHaveLength(1);
    const snapshot = rows[0].qualification_snapshot;
    expect(snapshot).toMatchObject({
      vehicle_type: expected.vehicle,
      down_payment: expected.down,
      down_payment_amount: expected.amount,
      required_down_payment: expected.minimum,
      down_payment_sufficient: expected.sufficient,
    });
    expect((snapshot.qualification_progress as { step?: string }).step).toBe(expected.nextStep);
      if (expected.sufficient) expect(['waiting_window', 'queued']).toContain(rows[0].status);
    else expect(rows[0].status).not.toBe('waiting_window');
  }, 20_000);
});
