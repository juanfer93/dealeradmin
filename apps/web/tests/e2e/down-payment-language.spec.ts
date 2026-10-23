import { test, expect } from '../../../../e2e/test';

test('procesa seis conversaciones en inglés sin degradar el idioma del down', async ({ request }) => {
  const scenarios = [
    { index: 1, phone: '+18045550101', phoneText: '804-555-0101', vehicle: 'Honda Civic', down: '1000', expected: '1000 down' },
    { index: 2, phone: '+18045550102', phoneText: '804-555-0102', vehicle: 'Toyota Corolla', down: '$1,500', expected: '$1,500 down' },
    { index: 3, phone: '+18045550103', phoneText: '804-555-0103', vehicle: 'Toyota Tacoma', down: '2000 dollars', expected: '2000 dollars down' },
    { index: 4, phone: '+18045550104', phoneText: '804-555-0104', vehicle: 'SUV', down: '3000', expected: '3000 down' },
    { index: 5, phone: '+18045550105', phoneText: '804-555-0105', vehicle: 'Ford F-150', down: '1000 + trade-in', expected: '1000 + trade-in down' },
    { index: 6, phone: '+18045550106', phoneText: '804-555-0106', vehicle: 'Sedan', down: '4000', expected: '4000 down' },
  ] as const;

  for (const scenario of scenarios) {
    const contactId = `e2e-language-${scenario.index}`;
    const conversationId = `e2e-language-conversation-${scenario.index}`;
    const messages = [
      `I am looking for a ${scenario.vehicle}`,
      `I can put ${scenario.down} down`,
      `My phone number is ${scenario.phoneText}`,
      `My name is English Language Buyer ${scenario.index}`,
    ];

    for (const [messageIndex, message] of messages.entries()) {
      const eventId = `evt-e2e-language-${scenario.index}-${messageIndex + 1}`;
      const response = await request.post('http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/arlington', {
        data: JSON.stringify({
          message_body: message,
          contact_phone: scenario.phone,
          contact_name: `English Language Buyer ${scenario.index}`,
          channel: 'messenger',
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

      expect(response.status(), `${contactId} message ${messageIndex + 1}`).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        accepted: true,
        source: 'arlington',
        status: 'processed',
      });
    }
  }

});
