import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('permite abrir la conversación del lead y renderiza WhatsApp y Messenger', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true }) }));
  await page.route('**/api/leads?*', async (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    const lead = {
      id: status === 'sent' ? 'sent-lead' : 'pending-lead', dealerId: 'demo-dealer', dealerName: 'Fredericksburg demo',
      name: status === 'sent' ? 'Alex Sent' : 'Ana Pending', phone: '+15551234567', vehicleType: 'SUV', downPayment: '$2,000',
      identification: null, bankAccount: null, documents: null, purchaseTimeline: 'this week', status, messageText: 'Lead de prueba', createdAt: '2026-11-01T10:00:00Z',
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dealers: [{ id: 'demo-dealer', code: 'FRED', name: 'Fredericksburg demo', pendingCount: 1 }], leads: [lead], wroteAgainCount: 0 }) });
  });

  await page.route('**/api/leads/*/conversation?*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [
      { id: 'whatsapp-demo', channel: 'whatsapp', status: 'queued', firstMessageAt: '2026-11-01T10:00:00Z', lastMessageAt: '2026-11-01T10:02:00Z', messages: [
        { id: 'wa-in', direction: 'inbound', body: 'Hola, busco una camioneta.', occurredAt: '2026-11-01T10:00:00Z' },
        { id: 'wa-out', direction: 'outbound', body: '¿Qué presupuesto tienes?', occurredAt: '2026-11-01T10:02:00Z' },
      ] },
      { id: 'messenger-demo', channel: 'messenger', status: 'queued', firstMessageAt: '2026-11-01T09:00:00Z', lastMessageAt: '2026-11-01T09:03:00Z', messages: [
        { id: 'ms-in', direction: 'inbound', body: 'Do you have SUVs?', occurredAt: '2026-11-01T09:00:00Z' },
        { id: 'ms-out', direction: 'outbound', body: 'Yes, what is your budget?', occurredAt: '2026-11-01T09:03:00Z' },
      ] },
    ] }) });
  });

  await page.goto('/app');
  const pendingRow = page.locator('tbody tr').filter({ hasText: 'Ana Pending' });
  await expect(pendingRow).toBeVisible();
  await pendingRow.getByRole('button', { name: 'Ver conversación' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('Hola, busco una camioneta.');
  await expect(modal).toContainText('En cola · calificación completa');
  await expect(modal.locator('header')).toContainText('WhatsApp');
  await expect(modal.getByRole('navigation', { name: 'Canales de conversación' }).getByRole('button')).toHaveCount(2);

  mkdirSync('output/screenshots', { recursive: true });
  await page.screenshot({ path: 'output/screenshots/conversation-viewer-whatsapp.png', fullPage: true });
  await modal.getByRole('button', { name: 'Messenger' }).click();
  await expect(modal).toContainText('Do you have SUVs?');
  await expect(modal.locator('header')).toContainText('Messenger');
  await page.screenshot({ path: 'output/screenshots/conversation-viewer-messenger.png', fullPage: true });

  await modal.getByRole('button', { name: 'Cerrar conversación' }).click();
  await page.getByRole('tab', { name: /Sent|Enviados/ }).click();
  const sentRow = page.locator('tbody tr').filter({ hasText: 'Alex Sent' });
  await expect(sentRow).toBeVisible();
  await sentRow.getByRole('button', { name: 'Ver conversación' }).click();
  await expect(page.getByRole('dialog')).toContainText('Hola, busco una camioneta.');
});
