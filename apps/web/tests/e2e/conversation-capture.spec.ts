import { test, expect } from '../../../../e2e/test';

test('recibe cada Customer Replied con el contact id y conversation id sin depender de custom fields', async ({ request }) => {
  const suffix = `ghl-e2e-single-${Date.now()}`;
  const response = await request.post('http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/stafford', {
    data: JSON.stringify({
      message_body: 'I am looking for an SUV.',
      contact_phone: '+13015550123',
      contact_name: 'Ana Torres',
      channel: 'whatsapp',
      event_id: `${suffix}-event`,
    }),
    headers: {
      'content-type': 'application/json',
      'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
      'X-DealerADMIN-Contact-ID': `${suffix}-contact`,
      'X-DealerADMIN-Conversation-ID': `${suffix}-conversation`,
      'X-DealerADMIN-Message-ID': `${suffix}-message`,
    },
  });

  expect(response.status()).toBe(201);
  await expect(response.json()).resolves.toMatchObject({ accepted: true, source: 'stafford', status: 'processed' });
});

test('acepta la conversación completa de Messenger con teléfono capturado en el chat', async ({ request }) => {
  const suffix = `ghl-e2e-messenger-${Date.now()}`;
  const messages = [
    'Busco una Honda Civic',
    'Mi número es 804-970-1204',
    'Puedo dar 2000 de down',
    'Lo compraré este mes',
    'Tengo mi licencia y estados de cuenta, y sí tengo cuenta bancaria',
    'Gracias',
  ];

  for (const [index, message] of messages.entries()) {
    const response = await request.post('http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/arlington', {
      data: JSON.stringify({
        message_body: message,
        contact_phone: index === 0 ? '' : undefined,
        contact_name: 'Emma Oertly',
        channel: 'messenger',
        event_id: `${suffix}-${index + 1}`,
      }),
      headers: {
        'content-type': 'application/json',
        'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
        'X-DealerADMIN-Contact-ID': `${suffix}-contact`,
        'X-DealerADMIN-Conversation-ID': `${suffix}-conversation`,
        'X-DealerADMIN-Message-ID': `${suffix}-message-${index + 1}`,
      },
    });

    expect(response.status()).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      source: 'arlington',
      status: 'processed',
    });
  }
});

test('reproduce Easterns y conserva el nombre real cuando el primer mensaje expresa intención de vehículo', async ({ request }) => {
  const suffix = `ghl-e2e-easterns-real-name-${Date.now()}`;
  const messages = ['Need a vehicle fast', 'SUV', 'Baltimore', '4433782388', 'Not much in hand 🤚 nothing to 500', 'Now', 'Yes'];

  for (const [index, message] of messages.entries()) {
    const eventId = `${suffix}-${index + 1}`;
    const response = await request.post('http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/easterns', {
      data: JSON.stringify({
        message_body: message,
        contact_phone: '',
        contact_name: 'Juiccy Zayy',
        channel: 'messenger',
        event_id: eventId,
      }),
      headers: {
        'content-type': 'application/json',
        'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
        'X-DealerADMIN-Contact-ID': `${suffix}-contact`,
        'X-DealerADMIN-Conversation-ID': `${suffix}-conversation`,
        'X-DealerADMIN-Message-ID': `${eventId}-message`,
      },
    });

    expect(response.status(), `Easterns message ${index + 1}`).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      source: 'easterns',
      status: 'processed',
    });
  }
});

test('usa el último vehículo y el teléfono correcto en Stafford WhatsApp y Fredericksburg Messenger', async ({ request }) => {
  const suffix = `ghl-e2e-latest-vehicle-${Date.now()}`;
  const scenarios = [
    {
      source: 'stafford',
      channel: 'whatsapp',
      contactPhone: '+19107093650',
      messages: ['Juan Jose Castillo', 'Estoy interesado en una Honda CRV 2014', 'O un Honda Civic 2012', 'Un sedan', '1500'],
    },
    {
      source: 'fredericksburg',
      channel: 'messenger',
      contactPhone: '',
      messages: ['Juan Jose Castillo', 'Estoy interesado en una Honda CRV 2014', 'O un Honda Civic 2012', 'Un sedan', '804-970-1204', 'Tengo 1500 para el down'],
    },
  ] as const;

  for (const scenario of scenarios) {
    const contactId = `${suffix}-${scenario.source}-contact`;
    const conversationId = `${suffix}-${scenario.source}-conversation`;
    for (const [index, message] of scenario.messages.entries()) {
      const eventId = `${suffix}-${scenario.source}-${index}`;
      const response = await request.post(`http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/${scenario.source}`, {
        data: JSON.stringify({
          message_body: message,
          contact_phone: scenario.contactPhone,
          contact_name: 'Juan Jose Castillo',
          channel: scenario.channel,
          event_id: eventId,
        }),
        headers: {
          'content-type': 'application/json',
          'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
          'X-DealerADMIN-Contact-ID': contactId,
          'X-DealerADMIN-Conversation-ID': conversationId,
          'X-DealerADMIN-Message-ID': `${eventId}-message`,
        },
      });

      expect(response.status(), `${scenario.source} message ${index + 1}`).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        accepted: true,
        source: scenario.source,
        status: 'processed',
      });
    }
  }
});

test('libera Stafford y Fredericksburg con solo teléfono y vehículo, sin down payment', async ({ request }) => {
  const suffix = `ghl-e2e-common-routing-${Date.now()}`;
  const scenarios = [
    {
      source: 'stafford',
      channel: 'whatsapp',
      contactPhone: '+15715558001',
      messages: ['Estoy buscando una Honda Civic'],
    },
    {
      source: 'fredericksburg',
      channel: 'messenger',
      contactPhone: '',
      messages: ['Estoy buscando una Toyota Tacoma', 'Mi número es 540-555-8002'],
    },
  ] as const;

  for (const scenario of scenarios) {
    const contactId = `${suffix}-${scenario.source}-contact`;
    const conversationId = `${suffix}-${scenario.source}-conversation`;
    for (const [index, message] of scenario.messages.entries()) {
      const eventId = `${suffix}-${scenario.source}-${index}`;
      const response = await request.post(`http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/${scenario.source}`, {
        data: JSON.stringify({
          message_body: message,
          contact_phone: scenario.contactPhone,
          contact_name: '',
          channel: scenario.channel,
          event_id: eventId,
        }),
        headers: {
          'content-type': 'application/json',
          'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
          'X-DealerADMIN-Contact-ID': contactId,
          'X-DealerADMIN-Conversation-ID': conversationId,
          'X-DealerADMIN-Message-ID': `${eventId}-message`,
        },
      });

      expect(response.status(), `${scenario.source} message ${index + 1}`).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        accepted: true,
        source: scenario.source,
        status: 'processed',
      });
    }
  }
});

test('acepta la conversación completa de WhatsApp con teléfono ya registrado', async ({ request }) => {
  const suffix = `ghl-e2e-whatsapp-${Date.now()}`;
  const messages = [
    'I am looking for a Honda Civic',
    'I can put 2000 down',
    'I will buy this month',
    'I have my driver license and bank statements, and I have a bank account',
    'My name is Elias Alvarado',
    'Thank you',
  ];

  for (const [index, message] of messages.entries()) {
    const response = await request.post('http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/stafford', {
      data: JSON.stringify({
        message_body: message,
        contact_phone: '+18049701205',
        contact_name: 'EliasJosue 🕊Mnegra',
        channel: 'whatsapp',
        event_id: `${suffix}-${index + 1}`,
      }),
      headers: {
        'content-type': 'application/json',
        'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
        'X-DealerADMIN-Contact-ID': `${suffix}-contact`,
        'X-DealerADMIN-Conversation-ID': `${suffix}-conversation`,
        'X-DealerADMIN-Message-ID': `${suffix}-message-${index + 1}`,
      },
    });

    expect(response.status()).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      source: 'stafford',
      status: 'processed',
    });
  }
});

test('cubre down regular y promoción Offlease en rutas positivas y negativas', async ({ request }) => {
  const suffix = `ghl-e2e-down-${Date.now()}`;
  const question = 'Para aplicar a la promoción de $1000 de enganche, ¿anteriormente ya has financiado algún vehículo?';
  const cases = [
    {
      source: 'stafford',
      channel: 'whatsapp',
      contact: `${suffix}-promo-stafford-positive`,
      conversation: `${suffix}-promo-stafford-positive-conversation`,
      phone: '+15715557001',
      messages: ['Carlos', 'Busco una SUV y tengo 1000 de down', question, 'Sí, podría'],
    },
    {
      source: 'fredericksburg',
      channel: 'messenger',
      contact: `${suffix}-promo-fred-negative`,
      conversation: `${suffix}-promo-fred-negative-conversation`,
      phone: '+15405557002',
      messages: ['Busco una Toyota Tacoma y tengo 1000 de down', '+1 (540) 555-7002', question, 'No, nunca'],
    },
    {
      source: 'fredericksburg',
      channel: 'messenger',
      contact: `${suffix}-down-fred-positive`,
      conversation: `${suffix}-down-fred-positive-conversation`,
      phone: '+15405557003',
      messages: ['Busco una Toyota Tacoma y tengo 3000 de down', '+1 (540) 555-7003', 'Lo compraré este mes'],
    },
    {
      source: 'stafford',
      channel: 'whatsapp',
      contact: `${suffix}-down-stafford-negative`,
      conversation: `${suffix}-down-stafford-negative-conversation`,
      phone: '+15715557004',
      messages: ['Maria', 'Busco una Toyota Tacoma y tengo 2000 de down', 'No puedo conseguir más'],
    },
  ] as const;

  for (const [caseIndex, scenario] of cases.entries()) {
    for (const [messageIndex, message] of scenario.messages.entries()) {
      const eventId = `${scenario.contact}-${messageIndex}`;
      const response = await request.post(`http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/${scenario.source}`, {
        data: JSON.stringify({
          message_body: message,
          contact_phone: scenario.phone,
          contact_name: `E2E Buyer ${caseIndex}`,
          channel: scenario.channel,
          event_id: eventId,
        }),
        headers: {
          'content-type': 'application/json',
          'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
          'X-DealerADMIN-Contact-ID': scenario.contact,
          'X-DealerADMIN-Conversation-ID': scenario.conversation,
          'X-DealerADMIN-Message-ID': `${eventId}-message`,
        },
      });

      expect(response.status(), `${scenario.source} ${scenario.channel} message ${messageIndex + 1}`).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        accepted: true,
        source: scenario.source,
      });
    }
  }
});
