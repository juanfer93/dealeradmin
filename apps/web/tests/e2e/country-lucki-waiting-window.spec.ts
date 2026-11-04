import { test, expect } from '../../../../e2e/test';
import type { APIRequestContext } from '@playwright/test';

const webhookSecret = 'test-ghl-secret-123456';
const initialNow = new Date('2026-11-04T15:00:00.000Z');

async function sendWhatsAppMessage(
  request: APIRequestContext,
  source: 'country' | 'lucki',
  contactId: string,
  phone: string,
  contactName: string,
) {
  const response = await request.post(`http://127.0.0.1:3010/api/webhooks/ghl/customer-replied/${source}`, {
    data: JSON.stringify({
      message_body: 'Estoy buscando una SUV',
      contact_phone: phone,
      contact_name: contactName,
      channel: 'whatsapp',
      event_id: `e2e-${source}-waiting-${Date.now()}`,
    }),
    headers: {
      'content-type': 'application/json',
      'X-DealerADMIN-Webhook-Secret': webhookSecret,
      'X-DealerADMIN-Contact-ID': contactId,
      'X-DealerADMIN-Conversation-ID': `${contactId}-conversation`,
      'X-DealerADMIN-Message-ID': `${contactId}-message`,
      'X-DealerADMIN-Test-Now': initialNow.toISOString(),
    },
  });

  expect(response.status(), await response.text()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    accepted: true,
    source,
    status: 'processed',
  });
}

test('Country Club y Lucki completan los cinco ciclos waiting_window y llegan a queued', async ({ request }) => {
  await sendWhatsAppMessage(request, 'country', 'e2e-country-cycles', '+18045550111', 'Country E2E Contact');
  await sendWhatsAppMessage(request, 'lucki', 'e2e-lucki-cycles', '+18045550112', 'Lucki E2E Contact');

  for (let cycle = 1; cycle <= 5; cycle += 1) {
    const now = new Date(initialNow.getTime() + cycle * 5 * 60 * 1000);
    const response = await request.post('http://127.0.0.1:3010/api/webhooks/ghl/conversations/process-due?contact_ids=e2e-country-cycles,e2e-lucki-cycles', {
      headers: {
        'X-DealerADMIN-Webhook-Secret': webhookSecret,
        'X-DealerADMIN-Test-Now': now.toISOString(),
      },
    });

    expect(response.status(), `waiting_window cycle ${cycle}`).toBe(201);
    const result = await response.json() as { advanced: number; processed: number };
    if (cycle < 5) {
      expect(result).toMatchObject({ advanced: 2, processed: 0 });
    } else {
      expect(result).toMatchObject({ advanced: 2, processed: 2 });
    }
  }
});
