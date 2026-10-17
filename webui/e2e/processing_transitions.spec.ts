import fs from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

function audioFixture(info: TestInfo, name: string): string {
  const fixture = info.outputPath(name);
  fs.writeFileSync(fixture, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  return fixture;
}

async function queueFile(page: Page, fixture: string): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(fixture);
  await expect(page.locator('.queue-card').first()).toBeVisible();
}

test('the queue slides down instead of jumping when processing starts', async ({ page }, info) => {
  await queueFile(page, audioFixture(info, 'slide.wav'));
  await page.waitForTimeout(400);

  const tops = page.evaluate(() => new Promise<number[]>(resolve => {
    const samples: number[] = [];
    const startedAt = performance.now();
    const sample = () => {
      const card = document.querySelector('.queue-card');
      if (card) samples.push(Math.round(card.getBoundingClientRect().top));
      if (performance.now() - startedAt < 450) requestAnimationFrame(sample);
      else resolve(samples);
    };
    requestAnimationFrame(sample);
  }));
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const samples = await tops;

  // The banner pushes the queue down by a few hundred pixels; it must not do so in one frame.
  expect(samples[samples.length - 1] - samples[0]).toBeGreaterThan(100);
  const largestStep = Math.max(...samples.slice(1).map((top, index) => Math.abs(top - samples[index])));
  expect(largestStep).toBeLessThan(100);
});
