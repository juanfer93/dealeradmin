import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationWebhookService } from '../../application/conversation-webhook.service';
import { WebhookIngressAuditService } from '../../application/webhook-ingress-audit.service';
import { WebhookProcessingAuditService } from '../../application/webhook-processing-audit.service';
import { WebhookService } from '../../application/webhook.service';
import { WebhooksController } from '../../presentation/webhooks.controller';
import { GeoroutingService } from '../../../routing/domain/services/georouting.service';

const databaseUrl = process.env.GHL_WEBHOOK_INGRESS_DATABASE_URL || process.env.DATABASE_URL;
const describeDatabase = databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;

type IngressCase = {
  source: 'stafford' | 'easterns' | 'koons-culpeper' | 'easterns-frederick';
  contactId: string;
  conversationId: string;
  expectedPhone: string | null;
  expectedVehicle?: string;
  expectedVehicleYear?: number;
  messages: Array<{ body: string; phone?: string; name: string; rawPayload?: Record<string, unknown> }>;
};

describeDatabase('GHL webhook ingress regression for the three reported leads', () => {
  let dataSource: DataSource;
  let testingModule: TestingModule;
  let app: any;
  let port: number;
  const suffix = `ghl-ingress-regression-${Date.now()}`;
  const ramContactId = `${suffix}-koons-ram-contact`;
  const ramConversationId = `${ramContactId}-conversation`;
  const cases: IngressCase[] = [
    {
      source: 'stafford',
      contactId: `${suffix}-stafford-contact`,
      conversationId: `${suffix}-stafford-conversation`,
      expectedPhone: '+17032297352',
      messages: [
        { body: 'For 250', phone: '(703) 229-7352', name: '🤷🏻‍♂️' },
        { body: 'Carlos', phone: '(703) 229-7352', name: '🤷🏻‍♂️' },
      ],
    },
    {
      source: 'easterns',
      contactId: `${suffix}-easterns-contact`,
      conversationId: `${suffix}-easterns-conversation`,
      expectedPhone: '+15714214544',
      messages: [{
        body: 'no gracias 5714214544',
        name: 'Jose Barahona',
        rawPayload: { tags: ['stop bot'], qualification_memory: '' },
      }],
    },
    {
      source: 'koons-culpeper',
      contactId: `${suffix}-koons-contact`,
      conversationId: `${suffix}-koons-conversation`,
      expectedPhone: '+17034342184',
      messages: [
        { body: 'hola busco una toyata tandra', name: 'Lucas Benavides' },
        { body: '703 434 2184', phone: '(703) 434-2184', name: 'Lucas Benavides' },
        { body: 'esta semana', phone: '(703) 434-2184', name: 'Lucas Benavides' },
      ],
    },
    {
      source: 'koons-culpeper',
      contactId: `${suffix}-osman-contact`,
      conversationId: 'l1XLPKir9XRJ38QFSgR0',
      expectedPhone: '+18049250909',
      messages: [
        { body: 'Puedo ver el inventario', phone: '', name: 'Osman Ali P Guillén' },
        { body: 'Troka', phone: '', name: 'Osman Ali P Guillén' },
        { body: '8049250909', phone: '8049250909', name: 'Osman Ali P Guillén' },
      ],
    },
    {
      source: 'easterns-frederick',
      contactId: `${suffix}-kathy-contact`,
      conversationId: 'fY1tKyiC4ouJgvx7vYM7',
      expectedPhone: null,
      messages: [
        { body: 'Can someone with a repo on their credit report get a vehicle??', phone: '(717) 404-1201', name: 'Kathy Warren' },
        { body: 'It’s my daughter who’s vehicle may not last much longer, it has over 250,000 miles on it & costs alot to repair right now. She’s the 1 with a repo from about 3 1/2 - 4 yrs ago.', phone: '(717) 404-1201', name: 'Kathy Warren' },
        { body: 'She has 3 kids, so she needs an SUV', phone: '(717) 404-1201', name: 'Kathy Warren' },
        { body: 'Do you have your job is your credit They both work full time', phone: '(717) 404-1201', name: 'Kathy Warren' },
        { body: 'They also have NO down payment available', phone: '(717) 404-1201', name: 'Kathy Warren' },
        { body: 'I guess just send it to me, & I’ll inform her', phone: '(717) 404-1201', name: 'Kathy Warren' },
        { body: 'Please, no phone calls, I work f/t with Uber Eats.', phone: '(717) 404-1201', name: 'Kathy Warren' },
        { body: 'Dobyou have any locations in W Va??', phone: '(717) 404-1201', name: 'Kathy Warren' },
      ],
    },
    {
      source: 'easterns-frederick',
      contactId: `${suffix}-jose-salcedo-contact`,
      conversationId: `${suffix}-jose-salcedo-conversation`,
      expectedPhone: '+18435311632',
      expectedVehicle: 'Toyota 4Runner 2016',
      expectedVehicleYear: 2016,
      messages: [
        { body: 'Buenos días, bueno quería que me diera una información para ver si tenían Toyota Runner del 2016 o 217-1819 20 alguno de esos modelos', name: 'Jose Luis Salcedo' },
        { body: '8435311632', phone: '(843) 531-1632', name: 'Jose Luis Salcedo' },
      ],
    },
    {
      source: 'easterns',
      contactId: `${suffix}-rosali-saravia-contact`,
      conversationId: `${suffix}-rosali-saravia-conversation`,
      expectedPhone: '+12025092809',
      expectedVehicle: 'RAV4',
      messages: [
        { body: 'Estoy buscando un raw4', name: 'Rosalí D Saravia' },
        { body: '202 5092809', phone: '(202) 509-2809', name: 'Rosalí D Saravia' },
        { body: 'Es mi número de cell', phone: '(202) 509-2809', name: 'Rosalí D Saravia' },
        { body: 'Hablo español', phone: '(202) 509-2809', name: 'Rosalí D Saravia' },
        { body: 'En laurel, Maryland', phone: '(202) 509-2809', name: 'Rosalí D Saravia' },
        { body: '1,500', phone: '(202) 509-2809', name: 'Rosalí D Saravia' },
      ],
    },
    {
      source: 'easterns-frederick',
      contactId: `${suffix}-sharon-contact`,
      conversationId: '2Bu1Br3sEqdrbknRkc9h',
      expectedPhone: null,
      messages: [
        { body: "Hello. I'm sorry. I don't understand spanish.", phone: '(240) 458-8934', name: 'Sharon Yates', rawPayload: { tags: ['stop bot'] } },
        { body: 'An suv', phone: '(240) 458-8934', name: 'Sharon Yates' },
        { body: 'Preferably an Armada or infinity qx55', phone: '(240) 458-8934', name: 'Sharon Yates' },
        { body: '$3000', phone: '(240) 458-8934', name: 'Sharon Yates' },
        { body: 'My credit falls into the bad category. I am looking to buy in a month once I have some pay stubs.', phone: '(240) 458-8934', name: 'Sharon Yates' },
        { body: 'I have an id but not proof of income. Thats the only reason I want to wait a month. I get my 1st check from my new job on the 23rd.', phone: '(240) 458-8934', name: 'Sharon Yates' },
        { body: 'Thanks', phone: '(240) 458-8934', name: 'Sharon Yates' },
      ],
    },
  ];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('GHL_WEBHOOK_INGRESS_DATABASE_URL or DATABASE_URL is required');
    dataSource = new DataSource({ type: 'postgres', url: databaseUrl, entities: [] });
    await dataSource.initialize();

    testingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConversationWebhookService,
          useFactory: () => new ConversationWebhookService(dataSource, new GeoroutingService(dataSource)),
        },
        { provide: WebhookIngressAuditService, useFactory: () => new WebhookIngressAuditService(dataSource) },
        { provide: WebhookProcessingAuditService, useFactory: () => new WebhookProcessingAuditService(dataSource) },
      ],
    }).compile();

    const controller = new WebhooksController(
      {} as WebhookService,
      testingModule.get(ConversationWebhookService),
      testingModule.get(WebhookIngressAuditService),
      testingModule.get(WebhookProcessingAuditService),
    );
    app = testingModule.createNestApplication({ rawBody: true, logger: false }) as typeof app;
    app.useBodyParser('json');
    app.getHttpAdapter().getInstance().post('/webhooks/ghl/customer-replied/:source', async (request: any, response: any) => {
      try {
        const parsedRawBody = JSON.parse(request.rawBody?.toString('utf8') ?? '{}');
        const body = request.body?.message_body || request.body?.message_attachments
          ? request.body
          : parsedRawBody;
        const result = await controller.receiveCustomerReplied(request.params.source, request, body);
        response.status(200).json(result);
      } catch (error) {
        response.status(500).json({ statusCode: 500, message: error instanceof Error ? error.message : 'Internal server error' });
      }
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Nest did not expose an ephemeral HTTP port');
    port = address.port;
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (testingModule) await testingModule.close();
    if (!dataSource?.isInitialized) return;
    for (const testCase of cases) {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [testCase.contactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [testCase.contactId]);
      await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [testCase.contactId]);
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [testCase.contactId]);
    }
    await dataSource.query('DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ghl_contact_id = $1)', [ramContactId]);
    await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [ramContactId]);
    await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [ramContactId]);
    await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [ramContactId]);
    await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [ramContactId]);
    await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-%`]);
    await dataSource.query('DELETE FROM webhook_processing_attempts WHERE ghl_contact_id LIKE $1', [`${suffix}-%`]);
    await dataSource.destroy();
  });

  it.each(cases)('$source $contactId accepts the reported partial lead and persists it', async (testCase) => {
    for (const [index, message] of testCase.messages.entries()) {
      const eventKey = testCase.contactId.includes('kathy')
        ? 'kathy'
        : testCase.contactId.includes('sharon')
          ? 'sharon'
          : testCase.contactId.includes('osman')
            ? 'osman'
            : testCase.contactId.includes('rosali')
              ? 'rosali'
            : testCase.source;
      const eventId = `${suffix}-${testCase.source}-${eventKey}-${index}`;
      const response = await postJson(port, `/webhooks/ghl/customer-replied/${testCase.source}`, {
        event_id: eventId,
        event_type: 'customer.replied',
        ghl_contact_id: testCase.contactId,
        ghl_conversation_id: testCase.conversationId,
        channel: testCase.source === 'stafford' ? 'whatsapp' : 'messenger',
        contact_name: message.name,
        contact_phone: message.phone ?? '',
        message_body: message.body,
        raw_payload: message.rawPayload,
        occurred_at: `2026-10-12T14:${String(index).padStart(2, '0')}:00.000Z`,
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ accepted: true });
    }

    const rows = await dataSource.query(
      `SELECT l.canonical_phone, l.first_name, l.last_name,
              c.status, c.qualification_snapshot,
              (SELECT count(*) FROM webhook_events e WHERE e.event_id LIKE $2) AS event_count
       FROM conversations c
       JOIN leads l ON l.id = c.lead_id
       WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $3`,
      [testCase.contactId, `${suffix}-${testCase.source}-${testCase.contactId.includes('kathy') ? 'kathy' : testCase.contactId.includes('sharon') ? 'sharon' : testCase.contactId.includes('osman') ? 'osman' : testCase.contactId.includes('rosali') ? 'rosali' : testCase.source}-%`, testCase.conversationId],
    ) as Array<{ canonical_phone: string; first_name: string; last_name: string; status: string; qualification_snapshot: Record<string, unknown>; event_count: string }>;

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].event_count)).toBe(testCase.messages.length);
    const processingRows = await dataSource.query(
      `SELECT processing_status, persisted_at, completed_at, duration_ms
       FROM webhook_processing_attempts
       WHERE ghl_contact_id = $1
       ORDER BY completed_at ASC`,
      [testCase.contactId],
    ) as Array<{ processing_status: string; persisted_at: string | null; completed_at: string; duration_ms: number | null }>;
    expect(processingRows).toHaveLength(testCase.messages.length);
    expect(processingRows.every((row) => row.processing_status === 'processed' && row.persisted_at && row.completed_at && Number(row.duration_ms) >= 0), JSON.stringify(processingRows)).toBe(true);
    expect(rows[0].canonical_phone).toBe(testCase.expectedPhone);
    expect(rows[0].qualification_snapshot).toMatchObject({ phone: testCase.expectedPhone ?? '' });
    if (testCase.source === 'easterns' && !testCase.contactId.includes('rosali')) expect(rows[0].qualification_snapshot).toMatchObject({ real_name: 'Jose Barahona' });
    if (testCase.source === 'stafford') expect(rows[0].qualification_snapshot).toMatchObject({ vehicle_type: 'F-250' });
    if (testCase.source === 'koons-culpeper' && !testCase.contactId.includes('osman')) expect(rows[0].qualification_snapshot).toMatchObject({ real_name: 'Lucas Benavides', vehicle_type: 'Toyota Tundra' });
    if (testCase.contactId.includes('osman')) expect(rows[0].qualification_snapshot).toMatchObject({ real_name: 'Osman Ali P Guillén', vehicle_type: 'truck' });
    if (testCase.contactId.includes('kathy')) expect(rows[0].qualification_snapshot).toMatchObject({ real_name: 'Kathy Warren', vehicle_type: 'SUV', down_payment: 'No down payment' });
    if (testCase.contactId.includes('sharon')) expect(rows[0].qualification_snapshot).toMatchObject({ real_name: 'Sharon Yates', vehicle_type: 'Armada', down_payment: '3000' });
    if (testCase.expectedVehicle) expect(rows[0].qualification_snapshot).toMatchObject({ vehicle_type: testCase.expectedVehicle });
    if (testCase.expectedVehicleYear) expect(rows[0].qualification_snapshot).toMatchObject({ vehicle_year: testCase.expectedVehicleYear });
    expect(['partial', 'waiting_window', 'queued', 'sent']).toContain(rows[0].status);
  }, 30_000);

  it('normalizes a misspelled Ram in Koons Fredericksburg and opens the waiting window', async () => {
    const messages = [
      'Vino enelisabes kiero una rram',
      '252 4553384',
      '1500',
      'Ableme nosekelejoestan vivo en Elizabeth ziti carolina',
      'Kiero presios',
    ];
    for (const [index, message] of messages.entries()) {
      const eventId = `${suffix}-koons-ram-${index + 1}`;
      const response = await postJson(port, '/webhooks/ghl/customer-replied/koons-fred', {
        event_id: eventId,
        event_type: 'customer.replied',
        ghl_contact_id: ramContactId,
        ghl_conversation_id: ramConversationId,
        channel: 'messenger',
        contact_name: 'Adhair Morales Mendoza',
        contact_phone: '+12524553384',
        message_body: message,
        occurred_at: new Date(Date.parse('2026-10-12T22:59:50.000Z') + index * 1_000).toISOString(),
      });
      expect(response.statusCode, `message ${index + 1}: ${response.body}`).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ accepted: true, source: 'koons-fred', status: 'processed' });
    }

    const rows = await dataSource.query(
      `SELECT c.status, c.qualification_snapshot
       FROM conversations c
       WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $2`,
      [ramContactId, ramConversationId],
    ) as Array<{ status: string; qualification_snapshot: Record<string, unknown> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'waiting_window' });
    expect(rows[0].qualification_snapshot).toMatchObject({ vehicle_type: 'Ram', vehicle_category: 'truck', qualification_complete: true });
  }, 30_000);

  it('persists Danny’s explicit request to see vehicle models and prices as options intent', async () => {
    const contactId = `${suffix}-danny-options-contact`;
    const conversationId = `${contactId}-conversation`;
    const messages = [
      'Tendría carros del 2015 o 2016 que sean Toyota o Honda',
      'Danny',
      'Este modelo de este año',
      'Honda Civic, Toyota Corolla Camry',
      '1500 pero deseo ver los modelos podría mandarme',
      'Quiero ver los modelos y los precios de eso voy a ver si compro',
      'Ok',
      'El que me guste',
      'Y el precio y el millaje',
    ];

    try {
      for (const [index, message] of messages.entries()) {
        const eventId = `${suffix}-danny-options-${index + 1}`;
        const response = await postJson(port, '/webhooks/ghl/customer-replied/stafford', {
          event_id: eventId,
          event_type: 'customer.replied',
          ghl_contact_id: contactId,
          ghl_conversation_id: conversationId,
          channel: 'whatsapp',
          contact_name: 'Danny',
          contact_phone: '+12405736525',
          message_body: message,
          occurred_at: new Date(Date.parse('2026-11-20T18:35:00.000Z') + index * 1_000).toISOString(),
        });
        expect(response.statusCode, `message ${index + 1}: ${response.body}`).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({ accepted: true, source: 'stafford', status: 'processed' });
      }

      const rows = await dataSource.query(
        `SELECT c.qualification_snapshot
         FROM conversations c
         WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $2`,
        [contactId, conversationId],
      ) as Array<{ qualification_snapshot: Record<string, unknown> }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].qualification_snapshot).toMatchObject({
        real_name: 'Danny',
        phone: '+12405736525',
        vehicle_type: expect.stringMatching(/Honda Civic.*Toyota Corolla/i),
        down_payment: '1500',
        purchase_timeline: 'explorando opciones',
      });
    } finally {
      await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contactId]);
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contactId]);
      await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-danny-options-%`]);
      await dataSource.query('DELETE FROM webhook_processing_attempts WHERE ghl_contact_id = $1', [contactId]);
    }
  }, 30_000);

  it('persists Josselin’s next-month timeline and Leydis’s SUV, trade-in, and check-pay evidence', async () => {
    const contacts = [
      {
        key: 'josselin-next-month',
        contactId: `${suffix}-josselin-contact`,
        conversationId: `${suffix}-josselin-conversation`,
        name: 'Josselin Sanchez',
        phone: '+14086077954',
        messages: ['Josselin Sánchez', 'Sedan normal', '1,000', '1500', 'El mes que viene', 'Si', 'Todos los días después de las 4:30'],
      },
      {
        key: 'leydis-suv-trade-in',
        contactId: `${suffix}-leydis-contact`,
        conversationId: `${suffix}-leydis-conversation`,
        name: 'Leydis',
        phone: '+12022929883',
        messages: [
          'Hola tengo una ven honda del 2012 que la quisiera dar de Dow payment ?? Me interesaría un carro menos de 20 mil',
          'La aplicación sería a nombre de mi Esposo Igor Vargas el tiene mal crédito',
          'Es correcto SUV el auto que busco',
          'Bueno para serte sincera lo que busco es dar la Honda de enganche sin dar dinero que la valoren la ven como el enganche',
          'Me puedes mandar el lik para ver todo los autos que tienes y te mando si me gusta alguna y podemos comenzar con el proceso te parece?',
          'Esta semana',
          'Tengo cheque de pagos',
          'Y la licencia',
          'Si',
        ],
      },
    ];

    try {
      for (const contact of contacts) {
        for (const [index, message] of contact.messages.entries()) {
          const response = await postJson(port, '/webhooks/ghl/customer-replied/stafford', {
            event_id: `${suffix}-${contact.key}-${index + 1}`,
            event_type: 'customer.replied',
            ghl_contact_id: contact.contactId,
            ghl_conversation_id: contact.conversationId,
            channel: 'whatsapp',
            contact_name: contact.name,
            contact_phone: contact.phone,
            message_body: message,
            occurred_at: new Date(Date.parse('2026-11-20T18:35:00.000Z') + index * 1_000).toISOString(),
          });
          expect(response.statusCode, `${contact.key} message ${index + 1}: ${response.body}`).toBe(200);
          expect(JSON.parse(response.body)).toMatchObject({ accepted: true, source: 'stafford', status: 'processed' });
        }
      }

      const snapshots = await Promise.all(contacts.map(async (contact) => {
        const rows = await dataSource.query(
          `SELECT c.qualification_snapshot FROM conversations c WHERE c.ghl_contact_id = $1 AND c.ghl_conversation_id = $2`,
          [contact.contactId, contact.conversationId],
        ) as Array<{ qualification_snapshot: Record<string, unknown> }>;
        expect(rows).toHaveLength(1);
        return rows[0].qualification_snapshot;
      }));

      expect(snapshots[0]).toMatchObject({
        real_name: expect.stringMatching(/Josselin S[aá]nchez/i),
        phone: '+14086077954',
        vehicle_type: 'Sedan',
        down_payment: '1500',
        purchase_timeline: 'próximo mes',
      });
      expect(snapshots[1]).toMatchObject({
        real_name: 'Leydis',
        phone: '+12022929883',
        vehicle_type: 'SUV',
        down_payment: 'trade-in',
        purchase_timeline: 'esta semana',
        identification: 'yes',
      });
      expect(String(snapshots[1].documents)).toContain('proof of income: yes');
    } finally {
      for (const contact of contacts) {
        await dataSource.query('DELETE FROM conversation_bot_pause_events WHERE ghl_contact_id = $1', [contact.contactId]);
        await dataSource.query('DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE ghl_contact_id = $1)', [contact.contactId]);
        await dataSource.query('DELETE FROM conversations WHERE ghl_contact_id = $1', [contact.contactId]);
        await dataSource.query('DELETE FROM lead_dealers WHERE lead_id IN (SELECT id FROM leads WHERE ghl_contact_id = $1)', [contact.contactId]);
        await dataSource.query('DELETE FROM leads WHERE ghl_contact_id = $1', [contact.contactId]);
        await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${suffix}-${contact.key}-%`]);
        await dataSource.query('DELETE FROM webhook_processing_attempts WHERE ghl_contact_id = $1', [contact.contactId]);
      }
    }
  }, 30_000);
});

function postJson(port: number, path: string, payload: Record<string, unknown>): Promise<{ statusCode: number; body: string }> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const clientRequest = request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-dealeradmin-contact-id': String(payload.ghl_contact_id),
        'x-dealeradmin-conversation-id': String(payload.ghl_conversation_id),
        'x-dealeradmin-message-id': String(payload.ghl_message_id ?? payload.event_id),
        'x-dealeradmin-test-now': '2026-10-12T23:00:00.000Z',
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { responseBody += chunk; });
      response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, body: responseBody }));
    });
    clientRequest.once('error', reject);
    clientRequest.end(body);
  });
}
