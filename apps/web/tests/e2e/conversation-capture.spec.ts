import { test, expect } from '../../../../e2e/test';

test('recibe cada Customer Replied con el contact id y conversation id sin depender de custom fields', async ({ request }) => {
  const response = await request.post('http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/stafford', {
    data: JSON.stringify({
      message_body: 'I am looking for an SUV.',
      contact_phone: '+13015550123',
      contact_name: 'Ana Torres',
      channel: 'whatsapp',
    }),
    headers: {
      'content-type': 'application/json',
      'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
      'X-DealerADMIN-Contact-ID': 'ghl-e2e-contact-1',
      'X-DealerADMIN-Conversation-ID': 'ghl-e2e-conversation-1',
      'X-DealerADMIN-Message-ID': 'ghl-e2e-message-1',
    },
  });

  expect(response.status()).toBe(201);
  await expect(response.json()).resolves.toMatchObject({ accepted: true, source: 'stafford', status: 'processed' });
});

test('acepta la conversación completa de Messenger con teléfono capturado en el chat', async ({ request }) => {
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
        event_id: `ghl-e2e-messenger-${index + 1}`,
      }),
      headers: {
        'content-type': 'application/json',
        'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
        'X-DealerADMIN-Contact-ID': 'ghl-e2e-messenger-contact',
        'X-DealerADMIN-Conversation-ID': 'ghl-e2e-messenger-conversation',
        'X-DealerADMIN-Message-ID': `ghl-e2e-messenger-message-${index + 1}`,
      },
    });

    expect(response.status()).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      source: 'arlington',
      conversationId: 'ghl-e2e-messenger-conversation',
      status: 'processed',
    });
  }
});

test('acepta la conversación completa de WhatsApp con teléfono ya registrado', async ({ request }) => {
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
        event_id: `ghl-e2e-whatsapp-${index + 1}`,
      }),
      headers: {
        'content-type': 'application/json',
        'X-DealerADMIN-Webhook-Secret': 'test-ghl-secret-123456',
        'X-DealerADMIN-Contact-ID': 'ghl-e2e-whatsapp-contact',
        'X-DealerADMIN-Conversation-ID': 'ghl-e2e-whatsapp-conversation',
        'X-DealerADMIN-Message-ID': `ghl-e2e-whatsapp-message-${index + 1}`,
      },
    });

    expect(response.status()).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      source: 'stafford',
      conversationId: 'ghl-e2e-whatsapp-conversation',
      status: 'processed',
    });
  }
});
