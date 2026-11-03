import { expect, test, type Page } from '@playwright/test';
import { readZip } from '../../src/web/zipArchive';

// A dummy key in the right format: these tests never call Gemini (the run is the M0 simulation).
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';

async function openSimulatedSbobina(page: Page) {
  await page.goto('/?simulazione=1');
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({ name: 'Lezione immagini.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 20_000 });
  await page.locator('.queue-card.is-completed', { hasText: 'Lezione immagini.mp3' }).click();
  await expect(page.locator('.tiptap-editor h1')).toBeVisible();
}

/** Pastes an image drawn in the page, as "Copy image" from another app would. Returns its data URL. */
async function pasteGeneratedImage(page: Page, width: number, height: number, type: 'image/png' | 'image/jpeg') {
  return page.evaluate(async ({ width, height, type }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    // Fine detail that JPEG recompression or downscaling would change.
    for (let x = 0; x < width; x += 2) {
      ctx.fillStyle = x % 4 ? '#1d4ed8' : '#f59e0b';
      ctx.fillRect(x, 0, 1, height);
    }
    ctx.fillStyle = '#000';
    ctx.font = '48px Arial';
    ctx.fillText('Slide 1: anatomia del cuore', 40, 120);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), type, 0.95));
    const original = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    const data = new DataTransfer();
    data.items.add(new File([blob], type === 'image/png' ? 'slide.png' : 'foto.jpg', { type }));
    const editor = document.querySelector<HTMLElement>('.tiptap-editor')!;
    editor.focus();
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return original;
  }, { width, height, type });
}

test('pasted images keep their quality and travel inside the .docx download @web-smoke', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSimulatedSbobina(page);

  // A Retina screenshot stays the same PNG, every pixel included.
  const slide = await pasteGeneratedImage(page, 2732, 2048, 'image/png');
  const images = page.locator('.tiptap-editor .editor-image-node img');
  await expect(images).toHaveCount(1);
  expect(await images.first().getAttribute('src')).toBe(slide);

  // A large photo is reduced to 4096 px as high-quality JPEG, never to the old 1600 px.
  await pasteGeneratedImage(page, 6000, 4000, 'image/jpeg');
  await expect(images).toHaveCount(2);
  const photo = await images.nth(1).evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return { src: img.src.slice(0, 23), width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(photo).toEqual({ src: 'data:image/jpeg;base64,', width: 4096, height: 2731 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Scarica .docx' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const entries = await readZip(new Blob([Buffer.concat(chunks)]));
  const media = [...entries.keys()].filter(name => name.startsWith('word/media/')).sort();
  expect(media).toEqual(['word/media/image1.png', 'word/media/image2.jpeg']);
  const embedded = Buffer.from(await (await entries.get('word/media/image1.png')!.blob()).arrayBuffer());
  expect(embedded.equals(Buffer.from(slide.split(',')[1], 'base64'))).toBe(true);
  const documentXml = await (await entries.get('word/document.xml')!.blob()).text();
  expect(documentXml).toContain('<w:pStyle w:val="Heading1"/>');
});
