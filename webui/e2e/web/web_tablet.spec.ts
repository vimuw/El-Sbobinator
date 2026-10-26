import { expect, test, type Locator, type Page } from '@playwright/test';

// iPad-sized viewport with touch emulated in Chromium (coarse pointer, no hover, taps): layout and
// copy for tablets. Not Safari: the on-screen keyboard, volume and real fingers need the device.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';

test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

/** Half the side of the square around the centre that a tap still lands on, tried up to 22px. */
async function tapReach(page: Page, target: Locator): Promise<number> {
  const box = (await target.boundingBox())!;
  return target.evaluate((el, { x, y }) => {
    const lands = (dx: number, dy: number) => {
      const hit = document.elementFromPoint(x + dx, y + dy);
      return !!hit && (hit === el || el.contains(hit));
    };
    let reach = 0;
    for (let d = 1; d <= 22; d++) {
      if (!lands(0, -d) || !lands(0, d)) break;
      reach = d;
    }
    return reach;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('the whole path works with taps on an iPad-sized screen @web-smoke', async ({ page }) => {
  await page.goto('/?simulazione=1');
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await page.getByRole('button', { name: 'Salva e inizia' }).tap();

  // Nothing is dragged onto the page on a tablet: the copy asks to pick files.
  await expect(page.getByText('Scegli un file audio o video per iniziare la prima sbobinatura.')).toBeVisible();
  await expect(page.getByText(/Trascina/)).toHaveCount(0);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Scegli i file da aggiungere' }).tap();
  await (await chooserPromise).setFiles({ name: 'Lezione tablet.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) });
  await expect(page.getByText('Tocca per aggiungere file')).toBeVisible();
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).tap();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 20_000 });
  await noSideScroll(page);

  // Small controls take a finger-sized tap: 16px archive checkbox, 36px sidebar icon.
  await page.getByRole('navigation').getByRole('button', { name: 'Archivio' }).tap();
  await expect(page.getByText('Archivio Sbobine')).toBeVisible();
  expect(await tapReach(page, page.getByRole('button', { name: 'Seleziona Lezione tablet' }))).toBeGreaterThanOrEqual(20);
  await noSideScroll(page);

  // The same sbobina is also the "last opened" card above the list.
  await page.locator('.archive-session-card', { hasText: 'Lezione tablet' }).last().tap();
  await expect(page.locator('.tiptap-editor h1')).toHaveText('Lezione tablet');
  await noSideScroll(page);
  const play = page.getByRole('button', { name: 'Avvia riproduzione' });
  await expect(play).toBeVisible();
  expect(await tapReach(page, play)).toBeGreaterThanOrEqual(20);
  expect(await tapReach(page, page.getByRole('button', { name: 'Torna indietro' }))).toBeGreaterThanOrEqual(20);

  // Landscape: the toolbar and the dock still fit across.
  await page.setViewportSize({ width: 1180, height: 820 });
  await noSideScroll(page);
  const dock = (await page.locator('.editor-player-dock').boundingBox())!;
  expect(dock.x + dock.width).toBeLessThanOrEqual(1180);
  expect(dock.y + dock.height).toBeLessThanOrEqual(820);
});
