import { createHmac } from 'node:crypto';
import { test, expect } from './test';

const payload = JSON.stringify({
  event_id: 'evt-e2e-1',
  event_type: 'lead.created',
  occurred_at: '2026-08-21T12:00:00Z',
  dealer_id: 'dealer-1',
  dealer_name: 'Test Dealer',
  ghl_location_id: 'location-1',
  ghl_contact_id: 'contact-1',
  lead: { name: 'Test Buyer', phone: '+15551234567' },
});

test('rejects a webhook with an invalid HMAC signature', async ({ request }) => {
  const response = await request.post('http://127.0.0.1:3010/api/webhooks', {
    data: payload,
    headers: { 'content-type': 'application/json', 'X-GHL-Signature': 'sha256:invalid' },
  });
  expect(response.status()).toBe(401);
});

test('accepts a webhook signed over the exact raw body', async ({ request }) => {
  const signature = createHmac('sha256', 'test-ghl-secret-123456').update(payload).digest('hex');
  const response = await request.post('http://127.0.0.1:3010/api/webhooks', {
    data: payload,
    headers: { 'content-type': 'application/json', 'X-GHL-Signature': `sha256=${signature}` },
  });
  expect(response.status()).toBe(201);
  expect(await response.json()).toEqual({ accepted: true, eventId: 'evt-e2e-1' });
});

test('redirects unauthenticated dashboard visits without rendering the lead queue', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { __sawLeadQueueLoading?: boolean };
    state.__sawLeadQueueLoading = false;
    const inspect = () => {
      if (document.body?.textContent?.includes('Cargando cola')) state.__sawLeadQueueLoading = true;
    };
    new MutationObserver(inspect).observe(document, { childList: true, subtree: true });
    inspect();
  });

  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => (window as Window & { __sawLeadQueueLoading?: boolean }).__sawLeadQueueLoading)).toBe(false);
});

test('logs in and reaches the protected dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByLabel('Username').fill('operator');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Lead work queue' })).toBeVisible();
  await expect(page.getByText('Webhook active')).toBeVisible();
});
