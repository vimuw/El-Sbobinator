import { expect, test } from '@playwright/test';

// One tab of the site at a time (activeTab.ts): the tabs of a browser share its archive and Web Locks.

const WAITING = 'El Sbobinator è aperto in un’altra scheda';
// A dummy key in the right format: the run is the M0 simulation, Gemini is never called.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';

test('a second tab waits for the first, takes over on "Usa qui" and opens when the other closes', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.getByLabel('Chiave API Gemini')).toBeVisible();

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: WAITING })).toBeVisible();
  await expect(second.getByLabel('Chiave API Gemini')).toHaveCount(0);

  await second.getByRole('button', { name: 'Usa qui' }).click();
  await expect(second.getByLabel('Chiave API Gemini')).toBeVisible();
  // The tab taken over reloads into the waiting page.
  await expect(first.getByRole('heading', { name: WAITING })).toBeVisible();
  await expect(first.getByLabel('Chiave API Gemini')).toHaveCount(0);

  await second.close();
  await expect(first.getByLabel('Chiave API Gemini')).toBeVisible();
  await expect(first.getByRole('heading', { name: WAITING })).toHaveCount(0);
});

test('"Usa qui" stops a tab in the middle of a run instead of leaving it working', async ({ context }) => {
  // Regression: the app asked before leaving during a run and the tab taken over kept working.
  const first = await context.newPage();
  await first.goto('/?simulazione=1');
  await first.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await first.getByRole('button', { name: 'Salva e inizia' }).click();
  const chooserPromise = first.waitForEvent('filechooser');
  await first.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({ name: 'Lezione.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) });
  await first.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(first.getByText('Trascrizione e sbobinatura')).toBeVisible();

  // A leave prompt answered "stay" would keep the tab working: none may appear.
  const prompts: string[] = [];
  first.on('dialog', dialog => {
    prompts.push(dialog.type());
    void dialog.dismiss();
  });
  const second = await context.newPage();
  await second.goto('/?simulazione=1');
  await second.getByRole('button', { name: 'Usa qui' }).click();
  await expect(first.getByRole('heading', { name: WAITING })).toBeVisible();
  expect(prompts).toEqual([]);
  // The tab that took over finds the interrupted lecture in the queue, ready to start again.
  await expect(second.getByRole('button', { name: /Avvia sbobinatura \(1 file\)/i })).toBeVisible();
});
