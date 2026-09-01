import { expect, test } from '../../../../e2e/test';

test.describe('Easterns routing, override y selección múltiple', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('rota Laurel -> Sterling, conserva Cash y copia una selección de dealers', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'operator');
    await page.fill('input[name="password"]', 'test-password');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole('button', { name: /^Easterns Laurel\s+\d+$/ }).click();
    const laurelRow = page.locator('tr').filter({ hasText: 'Andres Felipe' });
    await expect(laurelRow).toBeVisible();
    await expect(laurelRow).toContainText('Cash');
    await page.screenshot({ path: 'output/screenshots/day5-easterns-laurel-cash.png', fullPage: true });

    await laurelRow.getByLabel('Reasignar lead').selectOption({ label: 'Sterling' });
    await expect(laurelRow).not.toBeVisible();

    await page.getByRole('button', { name: /^Easterns Sterling\s+\d+$/ }).click();
    const sterlingRow = page.locator('tr').filter({ hasText: 'Andres Felipe' });
    await expect(sterlingRow).toBeVisible();
    await expect(sterlingRow).toContainText('Cash');
    await page.screenshot({ path: 'output/screenshots/day5-easterns-sterling-reassigned.png', fullPage: true });

    await page.getByLabel('Dealers: Easterns Rosedale').check();
    await page.getByLabel('Dealers: Easterns Laurel').check();
    await expect(page.getByRole('button', { name: 'Copiar todo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Copiar todo', exact: true }).click();
    await expect(page.getByRole('button', { name: '¡Todo copiado!', exact: true })).toBeVisible();
    await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toContain('Andres Felipe');
    await page.screenshot({ path: 'output/screenshots/day5-easterns-multi-copy.png', fullPage: true });
  });
});
