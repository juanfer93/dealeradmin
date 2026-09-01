import { test, expect } from './test';

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
    await page.getByRole('button', { name: /^Offlease Fredericksburg/ }).click();

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
      expect(route.request().postDataJSON()).toEqual({ status: 'sent', dealerId: 'dealer-fredericksburg' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await mariaRow.getByRole('button', { name: 'Marcar enviado' }).click();
    await expect(mariaRow).not.toBeVisible();
  });

  test('El operador puede borrar un lead y la acción llega al endpoint persistente', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'operator');
    await page.fill('input[name="password"]', 'test-password');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole('button', { name: /Offlease Motors Stafford\s+\d+/ }).click();
    await page.getByRole('button', { name: /Agregar lead manual/i }).click();
    const modal = page.getByRole('dialog', { name: 'Agregar lead manual' });
    await modal.getByLabel(/Nombre completo/).fill('Lead para borrar E2E');
    await modal.getByLabel(/Teléfono móvil/).fill('3019876501');
    await modal.getByRole('button', { name: 'Agregar lead' }).click();

    const row = page.locator('tr').filter({ hasText: 'Lead para borrar E2E' });
    await expect(row).toBeVisible();

    const deleteRequest = page.waitForRequest((request) => request.method() === 'DELETE' && request.url().includes('/api/leads/'));
    await row.getByRole('button', { name: 'Eliminar' }).click();
    const warning = page.getByRole('dialog', { name: 'Eliminar lead de la base de datos' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Eliminar de la BD' }).click();
    const request = await deleteRequest;
    expect(new URL(request.url()).searchParams.get('dealerId')).toBe('dealer-stafford');
    await expect(row).not.toBeVisible();
  });
});
