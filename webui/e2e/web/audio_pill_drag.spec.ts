import { expect, test } from './keyedTest';
import { expectPlaybackAudioReady, writeSilentWav } from '../audioFixture';

// Reported 2026-11-24: dragging the folded player moved the icon and its ring, while the glass
// circle (drawn by the dock around the pill) stayed in the corner.
test('dragging the folded player carries its whole glass circle', async ({ page }, info) => {
  const fixture = info.outputPath('pill.mp3');
  writeSilentWav(fixture);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?simulazione=rapida');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(fixture);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'pill' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  await expectPlaybackAudioReady(page);

  await page.getByRole('button', { name: 'Riduci il player a icona' }).click();
  const pill = page.getByRole('button', { name: /Mostra il player audio/ });
  await expect(pill).toBeVisible();
  const dock = page.locator('.editor-player-dock');
  await dock.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));

  // Whatever paints the circle has to be the pill: the dock around it stays bare.
  const paint = (el: Element) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
  };
  expect(await dock.evaluate(paint)).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
  const pillPaint = await pill.evaluate(paint);
  expect(pillPaint.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(pillPaint.shadow).not.toBe('none');

  const start = (await pill.boundingBox())!;
  const dockStart = (await dock.boundingBox())!;
  expect(start.width).toBe(50);
  expect(dockStart.width).toBeLessThanOrEqual(start.width);
  expect(dockStart.height).toBeLessThanOrEqual(start.height + 1);

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 200, start.y + start.height / 2, { steps: 8 });
  const moved = (await pill.boundingBox())!;
  expect(start.x - moved.x).toBeCloseTo(200, 0);
  // Nothing painted is left in the corner the pill came from.
  const leftBehind = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y)
    .filter(el => el.closest('.editor-fullpage-footer'))
    .filter(el => {
      const style = getComputedStyle(el);
      return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.boxShadow !== 'none' || style.borderTopWidth !== '0px';
    })
    .map(el => el.className), { x: start.x + start.width / 2, y: start.y + start.height / 2 });
  expect(leftBehind).toEqual([]);
  await page.screenshot({ path: info.outputPath('pill-dragging.png') });

  await page.mouse.move(100, start.y + start.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.audio-player.is-collapsed.is-left')).toBeVisible();
  const landed = (await pill.boundingBox())!;
  expect(landed.x).toBeLessThan(100);
  await page.screenshot({ path: info.outputPath('pill-left.png') });
});
