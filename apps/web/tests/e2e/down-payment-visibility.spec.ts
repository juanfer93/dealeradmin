import { expect, test } from '@playwright/test';

test('muestra los Down de Fredericksburg cuando el rango o sufijo llega a $1,500', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true }),
  }));
  await page.route('**/api/leads?*', async (route) => {
    const status = new URL(route.request().url()).searchParams.get('status') ?? 'pending';
    const leads = status === 'pending' ? [
      {
        id: 'fred-range', dealerId: 'fred', dealerName: 'Offlease Fredericksburg', name: 'Range Buyer',
        phone: '+15551234567', vehicleType: 'Sedan', downPayment: '$1,000–$1,500', status: 'pending',
        messageText: 'Lead E2E', createdAt: '2026-11-01T10:00:00Z',
      },
      {
        id: 'fred-k-suffix', dealerId: 'fred', dealerName: 'Offlease Fredericksburg', name: 'Suffix Buyer',
        phone: '+15551234568', vehicleType: 'Sedan', downPayment: '1.5k', status: 'pending',
        messageText: 'Lead E2E', createdAt: '2026-11-01T10:01:00Z',
      },
    ] : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dealers: [{ id: 'fred', code: 'FRED', name: 'Offlease Fredericksburg', pendingCount: leads.length }],
        leads,
        wroteAgainCount: 0,
      }),
    });
  });

  await page.goto('/app');
  await expect(page.locator('tbody tr').filter({ hasText: 'Range Buyer' })).toContainText('$1,000–$1,500');
  await expect(page.locator('tbody tr').filter({ hasText: 'Suffix Buyer' })).toContainText('1.5k');
});
