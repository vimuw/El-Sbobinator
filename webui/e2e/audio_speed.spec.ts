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
  const panel = page.getByRole('dialog', { name: 'Velocità di riproduzione' });
  const chip = page.locator('.player-speed-btn');
  const slider = page.getByRole('slider', { name: 'Velocità di riproduzione' });
  const faster = page.getByRole('button', { name: 'Aumenta velocità di riproduzione' });
  const slower = page.getByRole('button', { name: 'Diminuisci velocità di riproduzione' });
  const preset = (label: string) => page.getByRole('group', { name: 'Velocità rapide' }).getByRole('button', { name: label, exact: true });
  const geometry = (selectors: string[]) => footer.evaluate((root, selectors) => selectors.map(selector => {
    const { x, y, width, height } = root.querySelector(selector)!.getBoundingClientRect();
    return { x, y, width, height };
  }), selectors);

  // Desktop: the value in the bar opens the panel above it; the bar keeps its geometry at every speed.
  for (const width of [1680, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const selectors = ['.custom-scrubber', '.player-speed-wrap', '.player-speed-btn', '.custom-volume'];
      await chip.click();
      await expect(panel).toBeVisible();
      await preset('1x').click();
      const baseline = await geometry(selectors);
      const dock = (await page.locator('.editor-player-dock').boundingBox())!;
      const box = (await panel.boundingBox())!;
      expect(dock.y - (box.y + box.height)).toBeGreaterThanOrEqual(12);

      for (const [label, shown] of [['1,25x', '1,25x'], ['1,5x', '1,5x'], ['2x', '2x'], ['3x', '3x']]) {
        await preset(label).click();
        await expect(chip).toHaveText(shown);
        expect(await geometry(selectors)).toEqual(baseline);
      }
      await expect(faster).toBeDisabled();
      await slower.click();
      await expect(chip).toHaveText('2,95x');
      await slider.fill('0.5');
      await expect(chip).toHaveText('0,5x');
      await expect(slower).toBeDisabled();
      await slider.fill('1.15');
      await expect(chip).toHaveText('1,15x');
      expect(await geometry(selectors)).toEqual(baseline);
      expect(await footer.evaluate(root => root.scrollWidth <= root.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`speed-panel-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  }

  // Phone: the value sits left of the centred play and opens the same panel above the dock.
  await page.setViewportSize({ width: 480, height: 900 });
  await chip.click();
  await expect(panel).toBeVisible();
  const baseline = await geometry(['.custom-scrubber', '.player-play-control']);
  // The buttons' line is on top, so the panel rises from it and never covers the scrubber below.
  const [scrubberBox, playBox] = baseline;
  expect(playBox.y + playBox.height).toBeLessThanOrEqual(scrubberBox.y);
  const bar = (await page.locator('.audio-player').boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(bar.y - (box.y + box.height)).toBeGreaterThanOrEqual(12);
  await preset('2x').click();
  await faster.click();
  await expect(chip).toHaveText('2,05x');
  expect(await geometry(['.custom-scrubber', '.player-play-control'])).toEqual(baseline);
  const [, play] = baseline;
  expect(Math.abs(play.x + play.width / 2 - (bar.x + bar.width / 2))).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(await footer.evaluate(root => root.scrollWidth <= root.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('speed-phone-480.png') });
});
