import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('changing playback speed keeps the scrubber and controls in place', async ({ page }, info) => {
  const fixture = info.outputPath('speed.wav');
  fs.writeFileSync(fixture, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(fixture);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'speed.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();

  const footer = page.locator('.editor-fullpage-footer');
  const menu = page.getByTitle('Velocità di riproduzione', { exact: true });
  const faster = page.getByRole('button', { name: 'Aumenta velocità di riproduzione' });
  const slower = page.getByRole('button', { name: 'Diminuisci velocità di riproduzione' });
  const geometry = () => footer.evaluate(root => {
    const selectors = ['.custom-scrubber', '.player-speed-wrap', '.player-speed-btn', '.custom-volume'];
    return selectors.map(selector => {
      const { x, y, width, height } = root.querySelector(selector)!.getBoundingClientRect();
      return { x, y, width, height };
    });
  });

  for (const width of [1680, 1280, 480]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await menu.click();
      await page.getByRole('option', { name: '1x', exact: true }).click();
      const baseline = await geometry();

      for (const rate of [1.25, 1.5, 1.75, 2, 2.5, 3]) {
        await faster.click();
        await expect(menu).toHaveText(`${rate}x`);
        expect(await geometry()).toEqual(baseline);
      }
      await expect(faster).toBeDisabled();

      for (const rate of [2.5, 2, 1.75, 1.5, 1.25, 1]) {
        await slower.click();
        await expect(menu).toHaveText(`${rate}x`);
        expect(await geometry()).toEqual(baseline);
      }
      await expect(slower).toBeDisabled();
      await menu.click();
      await page.getByRole('option', { name: '1.75x', exact: true }).click();
      expect(await geometry()).toEqual(baseline);
      expect(await footer.evaluate(root => root.scrollWidth <= root.clientWidth)).toBe(true);
      await footer.screenshot({ path: info.outputPath(`speed-stable-${width}-${theme}.png`) });
    }
  }
});
