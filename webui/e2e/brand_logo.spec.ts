import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/rpc/load_settings', async route => {
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({ response, json: { ...settings, api_key: '', has_protected_key: false } });
  });
});

test('both cactus logos react to hover and click and return to rest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  const logos = page.getByRole('button', { name: 'Saluta El Sbobinator' });
  await expect(logos).toHaveCount(2);
  for (const logo of await logos.all()) {
    const image = logo.getByRole('img');
    await expect(image).toHaveCSS('transform', 'none');
    await logo.hover();
    await expect(logo).not.toHaveCSS('transform', 'none');
    await logo.click();
    await expect(image).not.toHaveCSS('transform', 'none');
    await page.mouse.move(1000, 700);
    await expect(image).toHaveCSS('transform', 'none');
    await expect(logo).toHaveCSS('transform', 'none');
  }
});

test('user gestures animate both cactus logos even with reduced motion enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  const logos = page.getByRole('button', { name: 'Saluta El Sbobinator' });
  for (const logo of await logos.all()) {
    const image = logo.getByRole('img');
    await expect(image).toHaveCSS('transform', 'none');
    await logo.hover();
    await expect(logo).not.toHaveCSS('transform', 'none');
    await expect(logo).toHaveCSS('opacity', '1');
    await page.keyboard.press('Tab');
    await logo.focus();
    await page.keyboard.press('Enter');
    await expect(image).not.toHaveCSS('transform', 'none');
    await expect(image).toHaveCSS('opacity', '1');
    await expect(image).toHaveCSS('transform', 'none');
  }
});

test('changing the system preference does not disable user gesture animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configura la tua API Key' })).toBeVisible();
  const logo = page.getByRole('navigation').getByRole('button', { name: 'Saluta El Sbobinator' });
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
