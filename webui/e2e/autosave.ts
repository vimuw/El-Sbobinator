import { expect, type Page } from '@playwright/test';

type AutosaveWindow = { __elSbobinatorGetDirtyEditorContent?: () => unknown };

// "Salvato" shows for only 1.5 s and an undo back to the saved text skips the
// save, so slow runs can miss the badge. Wait on the durable state instead:
// no pending edit, no save in flight, and the editor matches the last save.
export async function expectAutosaved(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const dirty = (window as unknown as AutosaveWindow).__elSbobinatorGetDirtyEditorContent;
    if (typeof dirty !== 'function') return 'editor not open';
    if (document.querySelector('.editor-autosave-badge')?.textContent?.includes('Errore')) return 'save error';
    return dirty() === null ? 'saved' : 'pending';
  })).toBe('saved');
}
