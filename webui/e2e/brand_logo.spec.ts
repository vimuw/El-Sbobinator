import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/rpc/load_settings', async route => {
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({ response, json: { ...settings, api_key: '', has_protected_key: false } });
  });
});

test('the setup cactus greets on click and both logos return to rest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  const greeter = page.getByRole('button', { name: 'Saluta El Sbobinator' });
  await expect(greeter).toHaveCount(1);
  const image = greeter.getByRole('img');
  await expect(image).toHaveCSS('transform', 'none');
  await greeter.hover();
  await expect(greeter).not.toHaveCSS('transform', 'none');
  await greeter.click();
  await expect(image).not.toHaveCSS('transform', 'none');
  await page.mouse.move(1000, 700);
  await expect(image).toHaveCSS('transform', 'none');
  await expect(greeter).toHaveCSS('transform', 'none');

  const sidebarLogo = page.getByRole('navigation').getByRole('button', { name: 'Vai alla Dashboard' });
  await sidebarLogo.hover();
  await expect(sidebarLogo).not.toHaveCSS('transform', 'none');
  await page.mouse.move(1000, 700);
  await expect(sidebarLogo).toHaveCSS('transform', 'none');
});

test('logo gestures animate even with reduced motion enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  const greeter = page.getByRole('button', { name: 'Saluta El Sbobinator' });
  const image = greeter.getByRole('img');
  await expect(image).toHaveCSS('transform', 'none');
  await greeter.hover();
  await expect(greeter).not.toHaveCSS('transform', 'none');
  await expect(greeter).toHaveCSS('opacity', '1');
  await greeter.focus();
  await page.keyboard.press('Enter');
  await expect(image).not.toHaveCSS('transform', 'none');
  await expect(image).toHaveCSS('opacity', '1');
  await expect(image).toHaveCSS('transform', 'none');

  const sidebarLogo = page.getByRole('navigation').getByRole('button', { name: 'Vai alla Dashboard' });
  await sidebarLogo.hover();
  await expect(sidebarLogo).not.toHaveCSS('transform', 'none');
});

test('changing the system preference does not disable logo gestures', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  const logo = page.getByRole('button', { name: 'Saluta El Sbobinator' });
  const image = logo.getByRole('img');
  await logo.hover();
  await expect(logo).not.toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(logo).not.toHaveCSS('transform', 'none');
  await logo.click();
  await expect(image).not.toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(logo).not.toHaveCSS('transform', 'none');
  await expect(image).toHaveCSS('transform', 'none');
  await logo.click();
  await expect(image).not.toHaveCSS('transform', 'none');
  await expect(image).toHaveCSS('opacity', '1');
});
