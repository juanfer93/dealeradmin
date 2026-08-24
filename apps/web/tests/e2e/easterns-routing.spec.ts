import { expect, test } from '@playwright/test';

test.describe('Easterns routing, override y selección múltiple', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('rota Laurel -> Sterling, conserva Cash y copia una selección de dealers', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('operator');
    await page.getByLabel('Password').fill('test-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole('button', { name: 'Easterns Laurel' }).click();
    const laurelRow = page.locator('tr').filter({ hasText: 'Andres Felipe' });
    await expect(laurelRow).toBeVisible();
    await expect(laurelRow).toContainText('Cash');
    await page.screenshot({ path: 'output/screenshots/day5-easterns-laurel-cash.png', fullPage: true });

    await laurelRow.getByLabel('Reasignar lead').selectOption({ label: 'Sterling' });
    await expect(laurelRow).not.toBeVisible();

    await page.getByRole('button', { name: 'Easterns Sterling' }).click();
    const sterlingRow = page.locator('tr').filter({ hasText: 'Andres Felipe' });
    await expect(sterlingRow).toBeVisible();
    await expect(sterlingRow).toContainText('Cash');
    await page.screenshot({ path: 'output/screenshots/day5-easterns-sterling-reassigned.png', fullPage: true });

    await page.getByLabel('Seleccionar Easterns Rosedale').check();
    await page.getByLabel('Seleccionar Easterns Laurel').check();
    await expect(page.getByRole('button', { name: 'Copiar todo' })).toBeVisible();
    await page.getByRole('button', { name: 'Copiar todo' }).click();
    await expect(page.getByRole('button', { name: '¡Todo copiado!' })).toBeVisible();
    await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toContain('Andres Felipe');
    await page.screenshot({ path: 'output/screenshots/day5-easterns-multi-copy.png', fullPage: true });
  });
});
