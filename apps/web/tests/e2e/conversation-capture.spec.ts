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
