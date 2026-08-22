import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('un lead enviado no reaparece en pendientes tras un webhook enriquecido', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('operator');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);

  const stafford = page.getByRole('button', { name: /Offlease Motors Stafford/ });
  await stafford.click();

  const pendingRow = page.locator('tr').filter({ hasText: 'Carlos Mendoza' });
  await expect(pendingRow).toBeVisible();
  await pendingRow.getByRole('button', { name: 'Marcar enviado' }).click();
  await expect(pendingRow).not.toBeVisible();

  const updatedLeadPayload = {
    event_id: `evt-smart-merge-${Date.now()}`,
    event_type: 'lead.ready_for_whatsapp',
    occurred_at: new Date().toISOString(),
    dealer_id: 'DLR-STAFF-001',
    dealer_name: 'Offlease Motors Stafford',
    ghl_location_id: 'loc_stafford_789',
    ghl_contact_id: 'ghl-contact-111',
    lead: {
      name: 'Carlos Mendoza',
      phone: '+15551234567',
      vehicle_type: 'Troca',
      down_payment: '$3,500',
      purchase_timeline: 'Solo estoy mirando',
      documents: 'Pasaporte e ID',
    },
  };
  const rawBody = JSON.stringify(updatedLeadPayload);
  const signature = createHmac('sha256', 'test-ghl-secret-123456').update(rawBody).digest('hex');
  const response = await request.post('http://127.0.0.1:3010/api/webhooks', {
    data: rawBody,
    headers: { 'content-type': 'application/json', 'X-GHL-Signature': `sha256=${signature}` },
  });
  expect(response.status()).toBe(201);

  await page.reload();
  await page.getByRole('button', { name: /Offlease Motors Stafford/ }).click();
  await expect(page.locator('tr').filter({ hasText: 'Carlos Mendoza' })).not.toBeVisible();

  await page.getByRole('tab', { name: 'Sent' }).click();
  const sentRow = page.locator('tr').filter({ hasText: 'Carlos Mendoza' });
  await expect(sentRow).toBeVisible();
  await expect(sentRow).toContainText('$3,500');
  await expect(sentRow).toContainText('Pasaporte e ID');
  await expect(sentRow).toContainText('Quiere ver opciones');
});
