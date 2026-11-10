import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueuePage, type QueuePageProps } from './QueuePage';
import { credentialStorageWarning } from '../credentialStorage';
import type { FileItem } from '../appState';
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
      hasProtectedKey: true,
      apiKeyInsecure: false,
      setApiKeyInsecure: vi.fn(),
      apiKeyInsecureReason: '',
      setApiKeyInsecureReason: vi.fn(),
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
      openFile: vi.fn(),
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

  it('shows insecure api key banner when apiKeyInsecure is true', () => {
    render(
      <QueuePage
        {...defaultProps}
        auth={{
          ...defaultProps.auth,
          apiKeyInsecure: true,
          apiKeyInsecureReason: 'DPAPI non disponibile',
        }}
      />,
    );
    expect(screen.getByText(/DPAPI non disponibile/i)).toBeTruthy();
  });

  it.each(['session_only', 'legacy_plaintext'] as const)(
    'opens credential settings without clearing the protected primary for %s fallback keys',
    fallback => {
      const handleOpenSettings = vi.fn();
      const setApiKey = vi.fn();
      const warning = credentialStorageWarning({ primary: 'protected', fallback });
      render(
        <QueuePage
          {...defaultProps}
          auth={{
            ...defaultProps.auth,
            apiKey: '',
            hasProtectedKey: true,
            fallbackKeys: ['fallback-key'],
            apiKeyInsecure: true,
            apiKeyInsecureReason: warning,
            setApiKey,
          }}
          actions={{ ...defaultProps.actions, handleOpenSettings }}
        />,
      );

      expect(screen.getByText(warning)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Gestisci credenziali' }));
      expect(handleOpenSettings).toHaveBeenCalledOnce();
      expect(setApiKey).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Rimuovi chiave' })).toBeNull();
    },
  );

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
          hasProtectedKey: false,
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
    expect(screen.getByText('fatta-2.mp3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Apri l'Archivio" }));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
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
