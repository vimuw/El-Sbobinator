import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueuePage, type QueuePageProps } from './QueuePage';
import type { FileItem } from '../appState';
import type { ArchiveSession } from '../bridge';
import { DEFAULT_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';
import { STORAGE_KEYS } from '../storageKeys';

vi.mock('../branding', async importOriginal => ({
  ...await importOriginal<typeof import('../branding')>(),
  GITHUB_URL: 'https://github.com/test',
}));

describe('QueuePage Component', () => {
  const defaultProps: QueuePageProps = {
    files: [],
    progress: {
      appState: 'idle',
      currentPhase: '',
      currentModel: 'gemini-2.5-flash',
      activeProgress: 0,
      workDone: { chunks: 0, macro: 0 },
      workTotals: { chunks: 0, macro: 0 },
      processingWarnings: [],
      batchCompleted: 0,
      batchTotal: 0,
      completionFlash: false,
    },
    auth: {
      apiReady: true,
      bridgeDelayed: false,
      apiKey: 'AIzaSyTestKey123456789012345678901234',
      setApiKey: vi.fn(),
      fallbackKeys: [],
      preferredModel: 'gemini-2.5-flash',

    },
    ingest: {
      isDragging: false,
      handleDragOver: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDrop: vi.fn(),
      handleBrowseClick: vi.fn(),
    },
    console: {
      showConsole: false,
      setShowConsole: vi.fn(),
      consoleLogs: [],
      isConsoleExpanded: false,
      setIsConsoleExpanded: vi.fn(),
      appendConsole: vi.fn(),
    },
    actions: {
      requestRemoveFile: vi.fn(),
      handleClearAll: vi.fn(),
      handleQueueRetry: vi.fn(),
      openPreview: vi.fn(),
      handleQueueStart: vi.fn(),
      handleQueueStop: vi.fn(),
      handleOpenSettings: vi.fn(),
      handleRemoveDoneFile: vi.fn(),
      handleRetryFailedRevisionBlocks: vi.fn(),
    },
    autoContinue: true,
    setAutoContinue: vi.fn(),
    archiveSessions: [],
    isArchiveLoaded: true,
    dndSensors: [],
    handleDragEnd: vi.fn(),
    completedSessionFolderMap: new Map(),
  };

  it('renders welcome dashboard when queue is empty and idle', () => {
    render(<QueuePage {...defaultProps} />);
    expect(screen.getByText(/Progetto Open-Source/i)).toBeTruthy();
  });

  it('renders loading view when apiReady is false', () => {
    render(
      <QueuePage
        {...defaultProps}
        auth={{
          ...defaultProps.auth,
          apiReady: false,
        }}
      />,
    );
    expect(screen.getByText(/Connessione in corso/i)).toBeTruthy();
  });

  it('renders SetupPage when in setup mode', async () => {
    render(
      <QueuePage
        {...defaultProps}
        auth={{
          ...defaultProps.auth,
          apiKey: '',
        }}
      />,
    );
    expect(await screen.findByText('Configura la tua API Key')).toBeTruthy();
  });

  const queuedFile: FileItem = { id: 'q1', name: 'lezione.mp3', size: 1024, duration: 60, status: 'queued', progress: 0, phase: 0 };

  it('centres the empty page but anchors the column to the top once work is on it', () => {
    const { rerender } = render(<QueuePage {...defaultProps} />);
    expect(screen.getByTestId('queue-column').className).toContain('my-auto');

    rerender(<QueuePage {...defaultProps} files={[queuedFile]} />);
    // A centred column would shift everything above when the taller banner swaps in.
    expect(screen.getByTestId('queue-column').className).toContain('mb-auto');
    expect(screen.getByTestId('queue-column').className).not.toContain('my-auto');
  });

  it('crossfades the dropzone into the processing banner instead of collapsing heights', async () => {
    const { rerender } = render(<QueuePage {...defaultProps} files={[queuedFile]} />);
    expect(screen.getByRole('button', { name: 'Aggiungi file audio o video' })).toBeTruthy();

    rerender(
      <QueuePage
        {...defaultProps}
        files={[{ ...queuedFile, status: 'processing', startedAt: Date.now() }]}
        progress={{ ...defaultProps.progress, appState: 'processing', currentPhase: 'Fase 1/3: trascrizione (chunk 1/4)', activeProgress: 12 }}
      />,
    );

    const bannerSlot = await screen.findByTestId('processing-banner-slot');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Aggiungi file audio o video' })).toBeNull());
    // The swapped content only fades; the shared slot owns the single height change.
    expect(bannerSlot.style.height).toBe('');
    expect(screen.getByTestId('processing-slot').contains(bannerSlot)).toBe(true);
  });

  // "Rivedi le sezioni" starts the same retry as the card: a failure already notified must not escape.
  it('revises the failed sections from the outcome banner and settles a notified failure', async () => {
    const { RevisionRetryError } = await import('../hooks/useRevisionRetry');
    const doneFile: FileItem = { ...queuedFile, status: 'done', outputHtml: '/sessions/s1/sbobina.html', outputDir: '/sessions/s1', revisionFailedBlocks: [2] };
    const handleRetryFailedRevisionBlocks = vi.fn(() => Promise.reject(new RevisionRetryError('Retry non riuscito.')));
    const runOutcome = { kind: 'warning' as const, fileId: doneFile.id, fileName: doneFile.name, htmlPath: doneFile.outputHtml, sessionDir: '/sessions/s1', revisionFailedBlocks: [2], warnings: [] };
    render(
      <QueuePage
        {...defaultProps}
        files={[doneFile]}
        progress={{ ...defaultProps.progress, runOutcome }}
        actions={{ ...defaultProps.actions, handleRetryFailedRevisionBlocks }}
      />,
    );

    fireEvent.click(within(screen.getByTestId('run-outcome-banner')).getByRole('button', { name: 'Rivedi le sezioni' }));
    expect(handleRetryFailedRevisionBlocks).toHaveBeenCalledWith('/sessions/s1', doneFile.id);
    await act(async () => { await Promise.resolve(); });
  });

  it('shows what the last run left above the dropzone, gives way to a new run and closes', async () => {
    const pausedFile: FileItem = { ...queuedFile, status: 'paused', errorText: 'phase1_chunk_failed_2' };
    const handleQueueRetry = vi.fn();
    const handleDismissRunOutcome = vi.fn();
    const runOutcome = { kind: 'paused' as const, fileId: pausedFile.id, fileName: pausedFile.name, error: 'phase1_chunk_failed_2', retryReason: 'circuit_breaker_paused', warnings: [] };
    const props = {
      ...defaultProps,
      files: [pausedFile],
      progress: { ...defaultProps.progress, runOutcome },
      actions: { ...defaultProps.actions, handleQueueRetry, handleDismissRunOutcome },
    };
    const { rerender } = render(<QueuePage {...props} />);

    const banner = screen.getByTestId('run-outcome-banner');
    expect(screen.getByTestId('processing-slot').contains(banner)).toBe(true);
    expect(screen.getByRole('button', { name: 'Aggiungi file audio o video' })).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Riprendi' }));
    expect(handleQueueRetry).toHaveBeenCalledWith(pausedFile.id);
    fireEvent.click(within(banner).getByRole('button', { name: 'Chiudi avviso' }));
    expect(handleDismissRunOutcome).toHaveBeenCalled();

    rerender(
      <QueuePage
        {...props}
        files={[{ ...pausedFile, status: 'processing', startedAt: Date.now() }]}
        progress={{ ...props.progress, appState: 'processing', currentPhase: 'Fase 1/3: trascrizione (chunk 2/4)' }}
      />,
    );
    await screen.findByTestId('processing-banner-slot');
    await waitFor(() => expect(screen.queryByTestId('run-outcome-banner')).toBeNull());
  });

  it('stops the run from the processing banner and links recent transcripts to the archive', () => {
    const handleQueueStop = vi.fn();
    const onOpenArchive = vi.fn();
    const done = Array.from({ length: 3 }, (_, i): FileItem => ({
      ...queuedFile, id: `d${i}`, name: `fatta-${i}.mp3`, status: 'done', completedAt: 100 - i, outputHtml: `/out/${i}.html`,
    }));
    render(
      <QueuePage
        {...defaultProps}
        files={[{ ...queuedFile, status: 'processing', startedAt: Date.now() }, ...done]}
        progress={{ ...defaultProps.progress, appState: 'processing', currentPhase: 'Fase 1/3: trascrizione (chunk 1/4)', activeProgress: 12 }}
        actions={{ ...defaultProps.actions, handleQueueStop }}
        onOpenArchive={onOpenArchive}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Interrompi' }));
    expect(handleQueueStop).toHaveBeenCalledTimes(1);
    expect(screen.getByText('fatta-2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Apri l'Archivio" }));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it('on the web claims "Audio non salvato" only for sbobine whose kept audio was read', () => {
    const done = (name: string, dir: string): FileItem => ({
      ...queuedFile, id: dir, name, status: 'done', completedAt: 1, outputHtml: `${dir}/out.html`, outputDir: dir,
    });
    const files = [done('tenuta.mp3', '/sessions/kept'), done('persa.mp3', '/sessions/gone')];
    const session = (dir: string, keptAudioBytes?: number): ArchiveSession => ({
      name: dir, completed_at_iso: '2026-11-19T10:00:00Z', html_path: `${dir}/out.html`, session_dir: dir, effective_model: '', input_path: '',
      ...(keptAudioBytes === undefined ? {} : { kept_audio_bytes: keptAudioBytes }),
    });
    const claims = () => screen.queryAllByTestId('completed-audio-not-kept').map(label => label.closest('.queue-card')?.textContent ?? '');
    try {
      // The browser's saved audio couldn't be read: the sbobine come back unmarked.
      const { rerender } = render(<QueuePage {...defaultProps} files={files} archiveSessions={[session('/sessions/kept'), session('/sessions/gone')]} />);
      expect(claims()).toEqual([]);
      // The first archive load failed: loaded, but nothing listed.
      rerender(<QueuePage {...defaultProps} files={files} archiveSessions={[]} />);
      expect(claims()).toEqual([]);
      // Read: only the sbobina without a copy says so.
      rerender(<QueuePage {...defaultProps} files={files} archiveSessions={[session('/sessions/kept', 5), session('/sessions/gone', 0)]} />);
      expect(claims()).toHaveLength(1);
      expect(claims()[0]).toContain('persa');
    } finally {
      setHostCapabilities(DEFAULT_CAPABILITIES);
    }
  });

  describe('console hint', () => {
    const running = (overrides: Partial<QueuePageProps> = {}) => (
      <QueuePage
        {...defaultProps}
        files={[{ ...queuedFile, status: 'processing', startedAt: Date.now() }]}
        progress={{ ...defaultProps.progress, appState: 'processing', currentPhase: 'Fase 1/3: trascrizione (chunk 1/4)', activeProgress: 12 }}
        {...overrides}
      />
    );
    const idle = (overrides: Partial<QueuePageProps> = {}) => <QueuePage {...defaultProps} files={[queuedFile]} {...overrides} />;
    // One run: idle, then processing, then idle again.
    const startRun = async (rerender: (ui: React.ReactElement) => void, overrides: Partial<QueuePageProps> = {}) => {
      rerender(running(overrides));
      await screen.findByTestId('processing-banner-slot');
    };

    beforeEach(() => localStorage.clear());

    it('tells what the console shows when a run starts with it closed, and opens it', async () => {
      const setShowConsole = vi.fn();
      const props = { console: { ...defaultProps.console, setShowConsole } };
      const { rerender } = render(idle(props));
      expect(screen.queryByTestId('console-hint')).toBeNull();

      await startRun(rerender, props);
      expect(await screen.findByText(/La console mostra ogni blocco, le attese e gli avvisi/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Apri console' }));
      expect(setShowConsole).toHaveBeenCalledWith(true);
      expect(localStorage.getItem(STORAGE_KEYS.SHOW_CONSOLE)).toBe('true');

      // Once the console is open, the hint is gone for good.
      rerender(running({ console: { ...props.console, showConsole: true } }));
      await waitFor(() => expect(screen.queryByTestId('console-hint')).toBeNull());
      expect(localStorage.getItem(STORAGE_KEYS.CONSOLE_HINT_V1)).toBe('done');
    });

    it('shows on the first three runs only, and never after the close button', async () => {
      const { rerender } = render(idle());
      for (let run = 1; run <= 3; run += 1) {
        await startRun(rerender);
        expect(await screen.findByTestId('console-hint')).toBeTruthy();
        rerender(idle());
        await waitFor(() => expect(screen.queryByTestId('console-hint')).toBeNull());
      }
      await startRun(rerender);
      expect(screen.queryByTestId('console-hint')).toBeNull();

      localStorage.clear();
      rerender(idle());
      await startRun(rerender);
      fireEvent.click(await screen.findByRole('button', { name: 'Chiudi e non mostrare più' }));
      await waitFor(() => expect(screen.queryByTestId('console-hint')).toBeNull());
      rerender(idle());
      await startRun(rerender);
      expect(screen.queryByTestId('console-hint')).toBeNull();
    });

    it('counts a batch of files as one run and stays put between its files', async () => {
      const batch = (batchCompleted: number, batchTotal = 3) => ({ progress: { ...defaultProps.progress, appState: 'processing' as const, batchCompleted, batchTotal } });
      // Between auto-continued files the app is idle for a moment, with the batch still counted.
      const between = (batchCompleted: number) => idle({ progress: { ...defaultProps.progress, batchCompleted, batchTotal: 3 } });
      const { rerender } = render(idle());
      await startRun(rerender, batch(0));
      expect(await screen.findByTestId('console-hint')).toBeTruthy();
      for (const completed of [0, 1]) {
        rerender(between(completed));
        expect(screen.getByTestId('console-hint')).toBeTruthy();
        await startRun(rerender, batch(completed + 1));
        expect(screen.getByTestId('console-hint')).toBeTruthy();
      }
      expect(localStorage.getItem(STORAGE_KEYS.CONSOLE_HINT_V1)).toBe('1');

      rerender(idle());
      await waitFor(() => expect(screen.queryByTestId('console-hint')).toBeNull());
      await startRun(rerender, batch(0, 1));
      expect(await screen.findByTestId('console-hint')).toBeTruthy();
      expect(localStorage.getItem(STORAGE_KEYS.CONSOLE_HINT_V1)).toBe('2');
    });

    it('stays quiet when the console is already open or the run was already going', async () => {
      const { rerender, unmount } = render(idle({ console: { ...defaultProps.console, showConsole: true } }));
      await startRun(rerender, { console: { ...defaultProps.console, showConsole: true } });
      expect(screen.queryByTestId('console-hint')).toBeNull();
      unmount();

      localStorage.clear();
      // Back from the archive mid-run: not a new start.
      render(running());
      await screen.findByTestId('processing-banner-slot');
      expect(screen.queryByTestId('console-hint')).toBeNull();
    });

    it('offers the console by the run: under the progress once the hint is retired, where the console goes otherwise', async () => {
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, 'done');
      const setShowConsole = vi.fn();
      const props = { console: { ...defaultProps.console, setShowConsole } };
      const { rerender } = render(idle(props));
      // No run: below the lists, where the console opens.
      const below = screen.getByRole('button', { name: 'Mostra console' });
      expect(screen.getByTestId('processing-slot').contains(below)).toBe(false);

      await startRun(rerender, props);
      const toggles = screen.getAllByRole('button', { name: 'Mostra console' });
      expect(toggles).toHaveLength(1);
      expect(screen.getByTestId('processing-banner-slot').contains(toggles[0])).toBe(true);
      fireEvent.click(toggles[0]);
      expect(setShowConsole).toHaveBeenCalledWith(true);
      expect(localStorage.getItem(STORAGE_KEYS.SHOW_CONSOLE)).toBe('true');

      rerender(running({ console: { ...props.console, showConsole: true } }));
      fireEvent.click(screen.getByRole('button', { name: 'Nascondi console' }));
      expect(setShowConsole).toHaveBeenLastCalledWith(false);
      expect(localStorage.getItem(STORAGE_KEYS.SHOW_CONSOLE)).toBe('false');
    });

    it('fades the toggle into the console and back in one slot instead of swapping them at once', async () => {
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, 'done');
      const { rerender } = render(idle());
      const slot = screen.getByTestId('console-slot');
      expect(slot.contains(screen.getByRole('button', { name: 'Mostra console' }))).toBe(true);

      rerender(idle({ console: { ...defaultProps.console, showConsole: true } }));
      // The toggle leaves first; the console comes in once it has gone, never both at once.
      expect(screen.getByRole('button', { name: 'Mostra console' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Chiudi console' })).toBeNull();
      const close = await screen.findByRole('button', { name: 'Chiudi console' });
      expect(slot.contains(close)).toBe(true);
      expect(screen.queryByRole('button', { name: 'Mostra console' })).toBeNull();

      rerender(idle());
      expect(screen.getByRole('button', { name: 'Chiudi console' })).toBeTruthy();
      expect(slot.contains(await screen.findByRole('button', { name: 'Mostra console' }))).toBe(true);
      expect(screen.queryByRole('button', { name: 'Chiudi console' })).toBeNull();

      // During a run the toggle sits under the progress and the slot is left empty.
      await startRun(rerender);
      await waitFor(() => expect(slot.querySelector('button')).toBeNull());
    });

    // A clip-path hid the folded part but kept it in the page's height, so a scrolled page jumped
    // by what was left when the console finally went. It clips with overflow, and only then.
    it('clips the console with overflow while it folds away, and not while it is open', async () => {
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, 'done');
      const open = { console: { ...defaultProps.console, showConsole: true } };
      const { rerender } = render(running(open));
      const folding = (await screen.findByRole('button', { name: 'Chiudi console' })).closest('.console-shell')!.parentElement!.parentElement as HTMLElement;
      expect(folding.style.overflow).toBe('');
      expect(folding.className).not.toContain('clip-path');

      rerender(running());
      expect(screen.getByRole('button', { name: 'Chiudi console' })).toBeTruthy();
      expect(folding.style.overflow).toBe('hidden');
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Chiudi console' })).toBeNull());
    });

    // After a reload with the console open (its state persists, and so do completed files) the
    // toggle below the lists had never been shown, so its height was unknown: the first close
    // folded the console to nothing, then the slot grew again for the toggle, and the footer dropped
    // and came back. It folds to the toggle's height even then.
    it('folds a console open since load to the height of the toggle that takes its place', async () => {
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, 'done');
      const doneFile: FileItem = { ...queuedFile, id: 'd1', status: 'done', completedAt: 1, outputHtml: '/sessions/d1/sbobina.html', outputDir: '/sessions/d1' };
      const page = (showConsole: boolean) => (
        <QueuePage {...defaultProps} files={[doneFile]} console={{ ...defaultProps.console, showConsole }} />
      );
      // jsdom computes no layout: the toggle's wrapper is 56 px tall, the open console 240 px.
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.querySelector(':scope > .console-toggle-row') ? 56 : 0;
      });
      const computed = window.getComputedStyle;
      let folding: Element | null = null;
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
        const style = computed(el, pseudo);
        if (el !== folding) return style;
        return new Proxy(style, {
          get: (target, key) => {
            if (key === 'height') return '240px';
            const value = Reflect.get(target, key, target) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
      });
      try {
        const { rerender } = render(page(true));
        folding = (await screen.findByRole('button', { name: 'Chiudi console' })).closest('.console-shell')!.parentElement!.parentElement;
        // The copy measured meanwhile is neither seen nor reachable.
        expect(screen.queryByRole('button', { name: 'Mostra console' })).toBeNull();
        const heights: string[] = [];
        const watch = new MutationObserver(() => heights.push((folding as HTMLElement).style.height));
        watch.observe(folding!, { attributes: true, attributeFilter: ['style'] });

        rerender(page(false));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Chiudi console' })).toBeNull(), { timeout: 2000 });
        watch.disconnect();
        expect(heights.at(-1)).toBe('56px');
        expect(screen.getByTestId('console-slot').contains(screen.getByRole('button', { name: 'Mostra console' }))).toBe(true);
      } finally {
        vi.restoreAllMocks();
      }
    });

    // Re-opened before it had folded away, the console re-entered with the height read as the fold
    // began, a browser's computed px, fixed on it, so logs expanded later spilled out of it. It goes
    // back to its own height.
    it('lets a console re-opened while it folds away grow with its content again', async () => {
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, 'done');
      const open = { console: { ...defaultProps.console, showConsole: true } };
      const { rerender } = render(running(open));
      const folding = (await screen.findByRole('button', { name: 'Chiudi console' })).closest('.console-shell')!.parentElement!.parentElement as HTMLElement;
      // jsdom computes no layout: report the open console's height in px, as a browser does.
      const computed = window.getComputedStyle;
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
        const style = computed(el, pseudo);
        if (el !== folding) return style;
        return new Proxy(style, {
          get: (target, key) => {
            if (key === 'height') return '240px';
            const value = Reflect.get(target, key, target) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
      });
      try {
        rerender(running());
        await act(() => new Promise<void>(resolve => setTimeout(resolve, 60)));
        expect(folding.style.overflow).toBe('hidden');
        rerender(running(open));
        expect(screen.getByRole('button', { name: 'Chiudi console' }).closest('.console-shell')!.parentElement!.parentElement).toBe(folding);
        await waitFor(() => expect(folding.style.overflow).toBe(''));
        await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
        expect(folding.style.opacity).toBe('1');
        expect(['', 'auto']).toContain(folding.style.height);
      } finally {
        vi.restoreAllMocks();
      }
    });

    // Re-opened mid-fold, the console dropped its clip at once while its height was still easing
    // back from the folded px, so its lower part drew past its box over the footer links. It keeps
    // clipping until it is open again, then lets the panel's shadow show.
    it('keeps clipping a console re-opened mid-fold until it has grown back', async () => {
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, 'done');
      const open = { console: { ...defaultProps.console, showConsole: true } };
      const { rerender } = render(running(open));
      const folding = (await screen.findByRole('button', { name: 'Chiudi console' })).closest('.console-shell')!.parentElement!.parentElement as HTMLElement;
      // jsdom computes no layout: report the open console's height in px, as a browser does.
      const computed = window.getComputedStyle;
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
        const style = computed(el, pseudo);
        if (el !== folding) return style;
        return new Proxy(style, {
          get: (target, key) => {
            if (key === 'height') return '240px';
            const value = Reflect.get(target, key, target) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
      });
      try {
        rerender(running());
        await act(() => new Promise<void>(resolve => setTimeout(resolve, 60)));
        expect(folding.style.overflow).toBe('hidden');

        const states: { height: string; overflow: string }[] = [];
        const watch = new MutationObserver(() => states.push({ height: folding.style.height, overflow: folding.style.overflow }));
        watch.observe(folding, { attributes: true, attributeFilter: ['style'] });
        rerender(running(open));
        expect(folding.style.overflow).toBe('hidden');
        await waitFor(() => expect(folding.style.overflow).toBe(''), { timeout: 2000 });
        watch.disconnect();

        // While its height is a px value it is still growing back, and stays clipped throughout.
        const growing = states.filter(s => s.height.endsWith('px'));
        expect(growing.length).toBeGreaterThan(0);
        expect(growing.filter(s => s.overflow !== 'hidden')).toEqual([]);
        expect(['', 'auto']).toContain(folding.style.height);
      } finally {
        vi.restoreAllMocks();
      }
    });

    // Scrolled once the slot had grown, the console unfolded below the screen unseen and the page
    // moved only afterwards. The page now follows the slot's growing edge frame by frame.
    it('keeps the console opened from under the progress in view while it unfolds', async () => {
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HINT_V1, 'done');
      // A 600 px page whose console slot ends `grown` px below the column's top, which sits at 400.
      let grown = 0;
      const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const scrolled = document.querySelector('main')?.scrollTop ?? 0;
        if (this.tagName === 'MAIN') return rect(0, 600);
        if (this.classList.contains('console-slot')) return rect(400 - scrolled, 400 + grown - scrolled);
        if (this.classList.contains('console-shell')) return rect(432 - scrolled, 400 + grown - scrolled);
        return rect(0, 0);
      });
      const frame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      try {
        function Page() {
          const [showConsole, setShowConsole] = React.useState(false);
          return running({ console: { ...defaultProps.console, showConsole, setShowConsole } });
        }
        render(<Page />);
        await screen.findByTestId('processing-banner-slot');
        const page = screen.getByRole('main');
        fireEvent.click(screen.getByRole('button', { name: 'Mostra console' }));
        await screen.findByRole('button', { name: 'Chiudi console' });

        // Still on screen: the page stays put.
        grown = 150;
        await frame();
        await frame();
        expect(page.scrollTop).toBe(0);
        // Past the bottom edge: the page follows it as it grows.
        grown = 260;
        await frame();
        await frame();
        expect(page.scrollTop).toBe(60);
        grown = 300;
        await frame();
        await frame();
        expect(page.scrollTop).toBe(100);
        // Taller than the room left, it stops with the console's top at the top of the page.
        grown = 900;
        await frame();
        await frame();
        expect(page.scrollTop).toBe(432);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('leaves the toggle out while the hint is up, so the run never offers the console twice', async () => {
      const { rerender } = render(idle());
      await startRun(rerender);
      expect(await screen.findByTestId('console-hint')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Mostra console' })).toBeNull();
    });
  });

  it('keeps the footer links whole for screen readers while a phone shows short labels', () => {
    render(<QueuePage {...defaultProps} />);
    const github = screen.getByRole('link', { name: 'Progetto Open-Source — GitHub' });
    expect(github.querySelector('.footer-label-long')?.textContent).toBe('Progetto Open-Source — GitHub');
    expect(github.querySelector('.footer-label-short')?.textContent).toBe('GitHub');
    expect(github.closest('footer')?.className).toContain('app-footer-links');
  });

  describe('full-window drop overlay', () => {
    const fileDrag = { dataTransfer: { types: ['Files'], files: [] } };

    function DraggablePage({ handleDrop = vi.fn() }: { handleDrop?: (e: React.DragEvent) => void }) {
      const [isDragging, setIsDragging] = React.useState(false);
      return (
        <QueuePage
          {...defaultProps}
          ingest={{
            ...defaultProps.ingest,
            isDragging,
            handleDragOver: e => { e.preventDefault(); setIsDragging(true); },
            handleDragLeave: () => setIsDragging(false),
            handleDrop: e => { setIsDragging(false); handleDrop(e); },
          }}
        />
      );
    }

    it('appears when a file is dragged anywhere over the page', () => {
      render(<DraggablePage />);
      expect(screen.queryByTestId('drop-overlay')).toBeNull();
      fireEvent.dragOver(screen.getByRole('main'), fileDrag);
      expect(screen.getByTestId('drop-overlay')).toBeTruthy();
      expect(screen.getByText('Rilascia per aggiungere')).toBeTruthy();
    });

    it('ignores drags that carry no files', () => {
      render(<DraggablePage />);
      fireEvent.dragOver(screen.getByRole('main'), { dataTransfer: { types: ['text/plain'] } });
      expect(screen.queryByTestId('drop-overlay')).toBeNull();
    });

    it('stays put while the drag crosses nested elements, and hides when it leaves the window', async () => {
      render(<DraggablePage />);
      const main = screen.getByRole('main');
      fireEvent.dragOver(main, fileDrag);
      fireEvent.dragLeave(main, { ...fileDrag, relatedTarget: screen.getByTestId('queue-column') });
      expect(screen.getByTestId('drop-overlay')).toBeTruthy();

      fireEvent.dragLeave(main, { ...fileDrag, relatedTarget: null });
      await waitFor(() => expect(screen.queryByTestId('drop-overlay')).toBeNull());
    });

    it('hides on Escape', async () => {
      render(<DraggablePage />);
      fireEvent.dragOver(screen.getByRole('main'), fileDrag);
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('drop-overlay')).toBeNull());
    });

    it('hands the drop to the ingest handler and hides', async () => {
      const handleDrop = vi.fn();
      render(<DraggablePage handleDrop={handleDrop} />);
      const main = screen.getByRole('main');
      fireEvent.dragOver(main, fileDrag);
      fireEvent.drop(main, fileDrag);
      expect(handleDrop).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByTestId('drop-overlay')).toBeNull());
    });
  });
});
