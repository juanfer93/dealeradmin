import { test, expect } from '@playwright/test';

test.describe('Día 4 E2E Tests - Dashboard & Queue Operation', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('Flujo del Operador: Login -> Selección de Dealer -> Normalización Visual -> Copiar Mensaje -> Marcar Enviado', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'operator');
    await page.fill('input[name="password"]', 'test-password');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/app$/);

    const sidebar = page.locator('aside, [role="navigation"]');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toContainText('Offlease Fredericksburg');
    await page.getByRole('button', { name: /Offlease Fredericksburg\s+1/ }).click();

    const mariaRow = page.locator('tr').filter({ hasText: 'Maria Lopez' });
    await expect(mariaRow).toBeVisible();
    await expect(mariaRow).toContainText('down no indicado');
    await expect(mariaRow).toContainText('documentos no indicados');
    await expect(mariaRow).toContainText('tiempo no indicado');

    await mariaRow.getByRole('button', { name: 'Copiar' }).click();
    await expect(mariaRow.getByRole('button', { name: '¡Copiado!' })).toBeVisible();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe('Maria Lopez +15559876543 Sedan.');

    await page.route('**/api/leads/**/status', async (route) => {
      expect(route.request().method()).toBe('PATCH');
      expect(route.request().postDataJSON()).toEqual({ status: 'sent' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await mariaRow.getByRole('button', { name: 'Marcar enviado' }).click();
    await expect(mariaRow).not.toBeVisible();
  });
});
