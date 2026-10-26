import { act, render, waitFor } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivePage } from '../components/NavSidebar';
import { parseScreenHash, screenHash, useHistoryNavigation } from './useHistoryNavigation';

describe('screen in the URL hash', () => {
  it('writes and reads back every screen', () => {
    const screens = [
      { page: 'queue' as const, settings: false, editor: null },
      { page: 'archive' as const, settings: false, editor: null },
      { page: 'queue' as const, settings: true, editor: null },
      { page: 'archive' as const, settings: true, editor: null },
      { page: 'archive' as const, settings: false, editor: 'web-session://3f2a-9c' },
    ];
    expect(screens.map(screenHash)).toEqual(['', '#/archivio', '#/impostazioni', '#/archivio/impostazioni', '#/archivio/sbobina/3f2a-9c']);
    for (const screen of screens) expect(parseScreenHash(screenHash(screen))).toEqual(screen);
  });

  it('opens the dashboard for an unknown hash', () => {
    expect(parseScreenHash('#/qualcosa')).toEqual({ page: 'queue', settings: false, editor: null });
    expect(parseScreenHash('#/sbobina/')).toEqual({ page: 'queue', settings: false, editor: null });
  });
});

type Harness = {
  page: ActivePage;
  settings: boolean;
  editor: string | null;
  setPage: (page: ActivePage) => void;
  setSettings: (open: boolean) => void;
  setEditor: (editor: string | null) => void;
};

function renderNavigation(options: { known?: string[]; ready?: boolean; saveFails?: boolean } = {}) {
  const harness = {} as Harness;
  const openEditor = vi.fn(async (dir: string) => {
    if (!(options.known ?? []).includes(dir)) return false;
    harness.setEditor(dir);
    return true;
  });
  const closeEditor = vi.fn(async () => {
    if (options.saveFails) return false;
    harness.setEditor(null);
    return true;
  });
  function Host({ ready }: { ready: boolean }) {
    const [page, setPage] = useState<ActivePage>('queue');
    const [settings, setSettings] = useState(false);
    const [editor, setEditor] = useState<string | null>(null);
    Object.assign(harness, { page, settings, editor, setPage, setSettings, setEditor });
    useHistoryNavigation({
      enabled: true,
      screen: useMemo(() => ({ page, settings, editor }), [page, settings, editor]),
      ready,
      setPage,
      setSettingsOpen: setSettings,
      openEditor,
      closeEditor,
    });
    return null;
  }
  const view = render(<Host ready={options.ready ?? true} />);
  return { harness, openEditor, closeEditor, setReady: (ready: boolean) => view.rerender(<Host ready={ready} />) };
}

async function goBack() {
  await act(async () => {
    window.history.back();
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}

async function goForward() {
  await act(async () => {
    window.history.forward();
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useHistoryNavigation', () => {
  it('puts each screen in the history, and Back/Forward move between them', async () => {
    const { harness } = renderNavigation({ known: ['web-session://abc'] });
    expect(window.location.hash).toBe('');

    act(() => harness.setPage('archive'));
    expect(window.location.hash).toBe('#/archivio');
    act(() => harness.setEditor('web-session://abc'));
    expect(window.location.hash).toBe('#/archivio/sbobina/abc');

    await goBack();
    expect(harness.editor).toBeNull();
    expect(harness.page).toBe('archive');
    expect(window.location.hash).toBe('#/archivio');

    await goForward();
    await waitFor(() => expect(harness.editor).toBe('web-session://abc'));
    expect(window.location.hash).toBe('#/archivio/sbobina/abc');

    await goBack();
    await goBack();
    expect(harness.page).toBe('queue');
    expect(window.location.hash).toBe('');
  });

  it('closing a screen from the app goes back instead of adding an entry', async () => {
    const { harness } = renderNavigation();
    act(() => harness.setSettings(true));
    expect(window.location.hash).toBe('#/impostazioni');
    expect(window.history.state).toEqual({ elSbobinatorBack: '' });
    const afterOpen = window.history.length;

    act(() => harness.setSettings(false));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(window.location.hash).toBe('');
    expect(harness.settings).toBe(false);
    expect(window.history.length).toBe(afterOpen);
    // Forward reopens the settings: the entry was not replaced by a new one.
    await goForward();
    expect(harness.settings).toBe(true);
  });

  it('a reload reopens the screen in the URL, the editor once the archive is loaded', async () => {
    window.history.replaceState(null, '', '/#/archivio/sbobina/abc');
    const { harness, openEditor, setReady } = renderNavigation({ known: ['web-session://abc'], ready: false });
    await act(async () => {});
    expect(harness.page).toBe('archive');
    expect(openEditor).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/archivio/sbobina/abc');

    await act(async () => setReady(true));
    expect(openEditor).toHaveBeenCalledWith('web-session://abc');
    expect(harness.editor).toBe('web-session://abc');
    expect(window.location.hash).toBe('#/archivio/sbobina/abc');
  });

  it('a sbobina no longer in this browser leaves its page in the URL', async () => {
    window.history.replaceState(null, '', '/#/archivio/sbobina/gone');
    const start = window.history.length;
    const { harness } = renderNavigation();
    await act(async () => {});
    expect(harness.page).toBe('archive');
    expect(harness.editor).toBeNull();
    expect(window.location.hash).toBe('#/archivio');
    expect(window.history.length).toBe(start);
  });

  it('Back keeps the editor open when its edits cannot be saved', async () => {
    const { harness, closeEditor } = renderNavigation({ known: ['web-session://abc'], saveFails: true });
    act(() => harness.setEditor('web-session://abc'));
    expect(window.location.hash).toBe('#/sbobina/abc');

    await goBack();
    expect(closeEditor).toHaveBeenCalled();
    expect(harness.editor).toBe('web-session://abc');
    expect(window.location.hash).toBe('#/sbobina/abc');
  });

  it('settings reloaded from the URL', async () => {
    window.history.replaceState(null, '', '/#/archivio/impostazioni');
    const { harness } = renderNavigation();
    await act(async () => {});
    expect(harness.page).toBe('archive');
    expect(harness.settings).toBe(true);
  });
});
