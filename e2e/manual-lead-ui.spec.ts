import { test, expect } from './test';

test('el operador puede crear un lead manual y verlo en la cola del dealer activo', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('button', { name: /^Offlease Motors Stafford\s+\d+$/ }).click();
  await page.getByRole('button', { name: /Agregar lead manual/i }).click();

  const modal = page.getByRole('dialog', { name: 'Agregar lead manual' });
  await expect(modal).toBeVisible();
  await modal.getByLabel(/Nombre completo/).fill('Pedro Infante');
  await modal.getByLabel(/Teléfono móvil/).fill('3019876543');
  await modal.getByLabel(/Tipo de vehículo/).fill('Troca');
  await modal.getByLabel(/Identificación/).fill('LIC-9900');
  await modal.getByRole('button', { name: 'Agregar lead' }).click();

  await expect(modal).not.toBeVisible();
  const leadRow = page.locator('tr').filter({ hasText: 'Pedro Infante' });
  await expect(leadRow).toBeVisible();
  await expect(leadRow).toContainText('+13019876543');
  await expect(leadRow).toContainText('down no indicado');
  await expect(leadRow).toContainText('documentos no indicados');
  await expect(leadRow).toContainText('ID: LIC-9900');

  await leadRow.getByRole('button', { name: 'Copiar' }).click();
  await expect(page.getByRole('button', { name: '¡Copiado!' })).toBeVisible();
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe('Pedro Infante +13019876543, Troca, ID: LIC-9900.');
});

test('la copia E2E omite el no down payment y limpia el prefijo de compra al explorar opciones', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await page.fill('input[name="username"]', 'operator');
  await page.fill('input[name="password"]', 'test-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole('button', { name: /^Offlease Motors Stafford\s+\d+$/ }).click();
  await page.getByRole('button', { name: /Agregar lead manual/i }).click();
  const modal = page.getByRole('dialog', { name: 'Agregar lead manual' });
  await modal.getByLabel(/Nombre completo/).fill('Elena Opciones');
  await modal.getByLabel(/Teléfono móvil/).fill('3019876544');
  await modal.getByLabel(/Tipo de vehículo/).fill('SUV');
  await modal.getByLabel(/Down payment/).fill('No tengo down payment');
  await modal.getByLabel(/Línea de tiempo de compra/).fill('quiere comprar explorando opciones');
  await modal.getByRole('button', { name: 'Agregar lead' }).click();

  const leadRow = page.locator('tr').filter({ hasText: 'Elena Opciones' });
  await expect(leadRow).toBeVisible();
  await expect(leadRow).toContainText('down no indicado');
  await expect(leadRow).toContainText('Quiere ver opciones');
  await expect(leadRow).not.toContainText('quiere comprar');
  await leadRow.getByRole('button', { name: 'Copiar' }).click();
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe('Elena Opciones +13019876544, SUV, Quiere ver opciones.');
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.not.toContain('down');
});
