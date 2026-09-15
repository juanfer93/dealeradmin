import { test, expect } from './test';

test('monthly report cron is protected and disabled mode does not generate', async ({ request }) => {
  const unauthorized = await request.get('http://127.0.0.1:3010/api/reports/monthly/run');
  expect(unauthorized.status()).toBe(401);

  const authorized = await request.get('http://127.0.0.1:3010/api/reports/monthly/run', {
    headers: { Authorization: 'Bearer test-cron-secret' },
  });
  expect(authorized.status()).toBe(200);
  expect(await authorized.json()).toMatchObject({ status: 'skipped_disabled' });

  const unauthorizedReprocess = await request.post('http://127.0.0.1:3010/api/reports/monthly/reprocess/2026-10');
  expect(unauthorizedReprocess.status()).toBe(401);
});

test('reports view shows the real disabled state without setup instructions', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/reports');

  await expect(page.getByText('Envío mensual de reportes: Inactivo')).toBeVisible();
  await expect(page.getByText(/Para prenderlo|variable de entorno/i)).toHaveCount(0);
});
