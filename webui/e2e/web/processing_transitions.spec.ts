import path from 'node:path';
import { expect, test } from './keyedTest';
import type { Page, TestInfo } from '@playwright/test';
import { writeSilentWav } from '../audioFixture';

function audioFixture(info: TestInfo, name: string): string {
  const fixture = info.outputPath(name);
  writeSilentWav(fixture);
  return fixture;
}

async function queueFile(page: Page, fixture: string): Promise<void> {
  await page.goto('/?simulazione=1');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(fixture);
  // Earlier tests on this worker's server leave completed cards: wait for this file.
  await expect(page.locator('.queue-card', { hasText: path.basename(fixture) })).toBeVisible();
}

test('the queue slides down instead of jumping when processing starts', async ({ page }, info) => {
  await queueFile(page, audioFixture(info, 'slide.mp3'));
  await page.waitForTimeout(400);

  // Long enough for the dropzone's fade-out and the slot's 320 ms height animation to end.
  const tops = page.evaluate(() => new Promise<Array<{ top: number; at: number }>>(resolve => {
    const samples: Array<{ top: number; at: number }> = [];
    const startedAt = performance.now();
    const sample = (now: number) => {
      const card = document.querySelector('.queue-card');
      if (card) samples.push({ top: Math.round(card.getBoundingClientRect().top), at: now });
      if (now - startedAt < 800) requestAnimationFrame(sample);
      else resolve(samples);
    };
    requestAnimationFrame(sample);
  }));
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const samples = await tops;

  // The banner pushes the queue down by a few hundred pixels; it must not do so in one frame.
  // Measured in time, not pixels per frame: the ease-out moves 50-60 px in each early frame, so
  // one frame dropped by a slow machine already looked like a jump.
  const start = samples[0].top;
  const end = samples[samples.length - 1].top;
  expect(end - start).toBeGreaterThan(100);
  const moved = samples.find(sample => Math.abs(sample.top - start) > 2)!;
  const arrived = samples.find(sample => Math.abs(end - sample.top) <= 2)!;
  expect(arrived.at - moved.at).toBeGreaterThanOrEqual(100);
  const between = new Set(samples.filter(sample => Math.abs(sample.top - start) > 2 && Math.abs(end - sample.top) > 2).map(sample => sample.top));
  expect(between.size).toBeGreaterThanOrEqual(2);
});

test('the player stays at the bottom while the editor is loading', async ({ page }, info) => {
  // Hold the editor chunk, including any idle preload, so the loading fallback stays visible.
  let releaseEditor = () => {};
  const editorGate = new Promise<void>(resolve => { releaseEditor = resolve; });
  // Matches the bundled chunk (assets/RichTextEditor-<hash>.js) and the dev source module.
  await page.route(/\/RichTextEditor[^/]*\.(js|tsx)(\?|$)/, async route => {
    await editorGate;
    await route.continue();
  });
  await queueFile(page, audioFixture(info, 'loading.mp3'));
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'loading' });
  await expect(completed).toBeVisible({ timeout: 15_000 });
  await completed.getByRole('heading').click();

  await expect(page.getByText('Caricamento editor...')).toBeVisible();
  const footer = await page.locator('.editor-fullpage-footer').boundingBox();
  const viewport = page.viewportSize()!;
  expect(footer!.y + footer!.height).toBeGreaterThan(viewport.height - 4);
  releaseEditor();
});
