import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';
import type { SaveHtmlResult } from '../src/bridge';

type AutosaveProbeWindow = Window & {
  __undoProbe: {
    path: string;
    calls: { content: string; generation: number; result?: SaveHtmlResult }[];
    release?: () => void;
    oldResponseDelivered?: boolean;
  };
  __elSbobinatorFlushPendingAutosave: () => Promise<boolean>;
};

for (const scenario of [
  { route: 'flush', delay: 'acknowledgement', release: 'before' },
  { route: 'flush', delay: 'acknowledgement', release: 'after' },
  { route: 'debounce', delay: 'acknowledgement', release: 'after' },
  { route: 'flush', delay: 'submission', release: 'after' },
] as const) {
  test(`undo survives reopen via ${scenario.route}, old ${scenario.delay} released ${scenario.release}`, async ({ page }, testInfo) => {
    const audio = testInfo.outputPath('autosave-undo.wav');
    fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
    await (await chooser).setFiles(audio);
    await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
    const completed = page.locator('.queue-card.is-completed', { hasText: 'autosave-undo.wav' });
    await expect(completed).toBeVisible({ timeout: 15000 });
    await completed.getByRole('heading').click();
    const editor = page.locator('.tiptap-editor');
    await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.commands.setContent('<p>ORIGINAL</p>'));
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    const originalModel = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());

    await page.evaluate(({ delay }) => {
      const w = window as AutosaveProbeWindow;
      const realSave = w.pywebview!.api.save_html_content.bind(w.pywebview!.api);
      w.__undoProbe = { path: '', calls: [] };
      w.pywebview!.api.save_html_content = async (path, content, generation) => {
        const probe = w.__undoProbe;
        probe.path = path;
        const call: (typeof probe.calls)[number] = { content, generation: generation! };
        probe.calls.push(call);
        const oldWrite = content.includes('MODIFICATO');
        if (oldWrite && delay === 'submission') {
          await new Promise<void>(resolve => { probe.release = resolve; });
        }
        const result = await realSave(path, content, generation);
        call.result = result;
        if (oldWrite && delay === 'acknowledgement') {
          await new Promise<void>(resolve => { probe.release = resolve; });
        }
        if (oldWrite) probe.oldResponseDelivered = true;
        return result;
      };
    }, scenario);

    await editor.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('MODIFICATO');
    await expect.poll(() => page.evaluate(() => typeof (window as AutosaveProbeWindow).__undoProbe.release)).toBe('function');
    const readDisk = () => page.evaluate(async () => {
      const w = window as AutosaveProbeWindow;
      return (await w.pywebview!.api.read_html_content(w.__undoProbe.path)).content;
    });
    const diskBeforeUndo = await readDisk();
    if (scenario.delay === 'acknowledgement') {
      expect(diskBeforeUndo).toContain('MODIFICATO');
      expect(await page.evaluate(() => (window as AutosaveProbeWindow).__undoProbe.calls[0].result))
        .toMatchObject({ ok: true, saved: true });
    } else {
      expect(diskBeforeUndo).toContain('ORIGINAL');
    }
    await page.keyboard.press('Control+z');
    await expect(editor).toHaveText('ORIGINAL');
    if (scenario.release === 'before') {
      await page.evaluate(() => (window as AutosaveProbeWindow).__undoProbe.release!());
      await expect.poll(() => page.evaluate(() => (window as AutosaveProbeWindow).__undoProbe.oldResponseDelivered)).toBe(true);
    }
    if (scenario.route === 'flush') {
      expect(await page.evaluate(() => (window as AutosaveProbeWindow).__elSbobinatorFlushPendingAutosave())).toBe(true);
    } else {
      await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    }
    await expect.poll(() => page.evaluate(() => (window as AutosaveProbeWindow).__undoProbe.calls.length)).toBe(2);
    expect(await readDisk()).toContain('ORIGINAL');
    if (scenario.release === 'after') {
      await page.evaluate(() => (window as AutosaveProbeWindow).__undoProbe.release!());
      await expect.poll(() => page.evaluate(() => (window as AutosaveProbeWindow).__undoProbe.oldResponseDelivered)).toBe(true);
    }
    const diskAfterRestore = await readDisk();
    expect(diskAfterRestore).toContain('ORIGINAL');
    expect(diskAfterRestore).not.toContain('MODIFICATO');
    const calls = await page.evaluate(() => (window as AutosaveProbeWindow).__undoProbe.calls);
    expect(calls[1].content).toContain('ORIGINAL');
    expect(calls[1].generation).toBeGreaterThan(calls[0].generation);
    expect(calls[1].result).toMatchObject({ ok: true, saved: true });
    if (scenario.delay === 'submission') expect(calls[0].result).toMatchObject({ ok: false, saved: false });
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await completed.getByRole('heading').click();
    await expect(editor).toHaveText('ORIGINAL');
    const reopenedModel = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
    expect(reopenedModel).toEqual(originalModel);
    const evidence = JSON.stringify({ scenario, calls, diskBeforeUndo, diskAfterRestore, originalModel, reopenedModel }, null, 2);
    fs.writeFileSync(testInfo.outputPath('readback.json'), evidence);
    await testInfo.attach('autosave-undo-readback', {
      body: evidence,
      contentType: 'application/json',
    });
  });
}
