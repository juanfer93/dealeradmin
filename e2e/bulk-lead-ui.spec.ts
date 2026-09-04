import { test, expect } from './test';

test('el operador puede subir leads masivos, ver duplicados y conservar los nuevos en la cola', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('button', { name: /^Offlease Motors Stafford\s+\d+$/ }).click();
  await expect(page.getByLabel('Dealer activo')).toContainText('Offlease Motors');
  await expect(page.getByLabel('Dealer activo')).toContainText('Stafford');
  await page.getByRole('button', { name: /Carga masiva/i }).click();
  const modal = page.getByRole('dialog', { name: 'Subir leads masivamente' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Leads para procesar').fill([
    'Carlos Mendoza +15551234567 SUV, 2,000 de down',
    'Lucia Gomez 3019876548 SUV, 2,000 de down, prueba de ingresos, quiere comprar esta semana',
  ].join('\n'));
  await modal.getByRole('button', { name: 'Subir leads' }).click();

  await expect(modal).toContainText('2 recibidos · 1 insertados · 1 duplicados · 0 inválidos');
  await expect(modal).toContainText('No se puede subir Carlos Mendoza con +15551234567 porque el nombre y teléfono ya pertenecen a un lead repetido en este dealer.');
  await expect(page.locator('tr').filter({ hasText: 'Lucia Gomez' })).toContainText('+13019876548');
});
