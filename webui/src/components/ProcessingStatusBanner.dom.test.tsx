import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProcessingStatusBanner } from './ProcessingStatusBanner';

describe('ProcessingStatusBanner', () => {
  it('shows the active revision section instead of 0/x', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 2/3: revisione"
        currentModel="gemini-3.6-flash"
        activeProgress={86}
        workDone={{ chunks: 8, macro: 0 }}
        workTotals={{ chunks: 11, macro: 11 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="FISIOLOGIA 2, LEZIONE 5.mp3"
        startedAt={Date.now() - 90_000}
      />,
    );

    expect(screen.getByText('Sezione 1 di 11')).toBeTruthy();
    expect(screen.queryByText(/ETA/i)).toBeNull();
  });

  it('renders explanatory tooltips for each step', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 1/3: trascrizione (chunk 2/6)"
        currentModel="gemini-3.6-flash"
        activeProgress={34}
        workDone={{ chunks: 1, macro: 0 }}
        workTotals={{ chunks: 6, macro: 3 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );

    expect(screen.getByText(/Normalizza l'audio/i)).toBeTruthy();
    expect(screen.getByText(/genera la prima sbobinatura dettagliata/i)).toBeTruthy();
    expect(screen.getByText(/ripulito, organizzato e reso più chiaro/i)).toBeTruthy();
  });

  it('shows file counter chip when currentBatchTotal > 1', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 1/3: trascrizione (chunk 1/3)"
        currentModel="gemini-2.5-flash"
        activeProgress={20}
        workDone={{ chunks: 0, macro: 0 }}
        workTotals={{ chunks: 3, macro: 3 }}
        currentFileIndex={1}
        currentBatchTotal={3}
        currentFileName="lesson.mp3"
        startedAt={Date.now() - 30_000}
      />,
    );
    expect(screen.getByText('File 2 di 3')).toBeTruthy();
  });

  it('shows wait banner for Server Gemini occupato phase', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Server Gemini occupato — ritento tra 3s"
        currentModel="gemini-2.5-flash"
        activeProgress={30}
        workDone={{ chunks: 2, macro: 0 }}
        workTotals={{ chunks: 6, macro: 6 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );
    expect(screen.getByText('In attesa...')).toBeTruthy();
  });

  it('shows pause banner for Rate limit phase', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Rate limit: attendo 60s"
        currentModel="gemini-2.5-flash"
        activeProgress={40}
        workDone={{ chunks: 3, macro: 0 }}
        workTotals={{ chunks: 6, macro: 6 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );
    expect(screen.getByText('Pausa automatica')).toBeTruthy();
  });

  it('shows all-done stepper for __completed__ phase', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="__completed__"
        currentModel="gemini-2.5-flash"
        activeProgress={100}
        workDone={{ chunks: 6, macro: 6 }}
        workTotals={{ chunks: 6, macro: 6 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );
    expect(screen.getByText('Sbobinatura completata!')).toBeTruthy();
  });

  it('shows macro progress from (blocco X/Y) regex in Fase 2/3', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 2/3: revisione (blocco 3/8)"
        currentModel="gemini-2.5-flash"
        activeProgress={40}
        workDone={{ chunks: 6, macro: 3 }}
        workTotals={{ chunks: 6, macro: 8 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );
    expect(screen.getByText('Sezione 3 di 8')).toBeTruthy();
  });

  it('shows preconversione as active step during Fase 0/3', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 0/3: preconversione"
        currentModel="gemini-2.5-flash"
        activeProgress={5}
        workDone={{ chunks: 0, macro: 0 }}
        workTotals={{ chunks: 0, macro: 0 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );
    expect(screen.getByText('Pre-conversione audio')).toBeTruthy();
  });

  it('renders without progress label when phase does not match any known pattern', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="In attesa"
        currentModel="gemini-2.5-flash"
        activeProgress={0}
        workDone={{ chunks: 0, macro: 0 }}
        workTotals={{ chunks: 0, macro: 0 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );
    expect(screen.queryByText(/Blocco|Sezione/)).toBeNull();
  });

  it('shows Fase 1/3 progress label when no chunk number in phase', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 1/3: preconversione"
        currentModel="gemini-2.5-flash"
        activeProgress={10}
        workDone={{ chunks: 0, macro: 0 }}
        workTotals={{ chunks: 5, macro: 5 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );
    expect(screen.getByText(/Blocco \d+ di 5/)).toBeTruthy();
  });

  it('shows hours in elapsed chip when startedAt is > 1 hour ago', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 2/3: revisione"
        currentModel="gemini-2.5-flash"
        activeProgress={50}
        workDone={{ chunks: 10, macro: 5 }}
        workTotals={{ chunks: 10, macro: 10 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="long.mp3"
        startedAt={Date.now() - 4_000_000}
      />,
    );
    expect(screen.getByText(/\d+h \d+m/)).toBeTruthy();
  });

  it('shows the next phase title immediately instead of leaving the header empty', () => {
    const props = {
      appState: 'processing' as const,
      currentModel: 'gemini-3.6-flash',
      activeProgress: 0,
      workDone: { chunks: 0, macro: 0 },
      workTotals: { chunks: 6, macro: 5 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'lesson.mp3',
    };
    const { rerender } = render(<ProcessingStatusBanner {...props} currentPhase="" />);
    expect(screen.getByRole('heading', { name: 'Preparazione...' })).toBeTruthy();

    rerender(<ProcessingStatusBanner {...props} activeProgress={2} currentPhase="Fase 0/3: pre-conversione audio" />);

    expect(screen.getByRole('heading', { name: 'Pre-conversione audio' })).toBeTruthy();
  });

  it('keeps one live indicator during a phase and draws the check on success', () => {
    const props = {
      appState: 'processing' as const,
      currentModel: 'gemini-2.5-flash',
      workDone: { chunks: 1, macro: 0 },
      workTotals: { chunks: 4, macro: 2 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'lesson.mp3',
    };
    const { container, rerender } = render(
      <ProcessingStatusBanner {...props} currentPhase="Fase 1/3: trascrizione (chunk 2/4)" activeProgress={40} />,
    );
    expect(container.querySelector('.animate-ping, .animate-pulse, .blur-3xl')).toBeNull();
    expect(screen.getByTestId('progress-percent').textContent).toBe('40%');

    rerender(<ProcessingStatusBanner {...props} currentPhase="__completed__" activeProgress={100} />);
    expect(screen.getByTestId('drawn-check')).toBeTruthy();
  });

  describe('segmented phase track', () => {
    const base = {
      appState: 'processing' as const,
      currentModel: 'gemini-2.5-flash',
      activeProgress: 35,
      workDone: { chunks: 3, macro: 0 },
      workTotals: { chunks: 6, macro: 4 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'lesson.mp3',
    };
    const states = () => ['preconversione', 'trascrizione', 'revisione'].map(
      key => screen.getByTestId(`phase-segment-${key}`).getAttribute('data-state'),
    );

    it('fills completed steps and marks the running one active', () => {
      const { rerender } = render(<ProcessingStatusBanner {...base} currentPhase="Fase 1/3: trascrizione (chunk 4/6)" />);
      expect(states()).toEqual(['done', 'active', 'pending']);
      expect(screen.getByRole('progressbar', { name: 'Avanzamento' }).getAttribute('aria-valuenow')).toBe('35');

      rerender(<ProcessingStatusBanner {...base} currentPhase="Fase 2/3: revisione (blocco 1/4)" activeProgress={72} />);
      expect(states()).toEqual(['done', 'done', 'active']);

      rerender(<ProcessingStatusBanner {...base} currentPhase="__completed__" activeProgress={100} />);
      expect(states()).toEqual(['done', 'done', 'done']);
    });

    it('keeps the step labels focusable with their explanation', () => {
      render(<ProcessingStatusBanner {...base} currentPhase="Fase 0/3: pre-conversione audio" activeProgress={0} />);
      expect(states()).toEqual(['active', 'pending', 'pending']);
      const label = screen.getByLabelText(/^Trascrizione\. Il modello analizza/);
      expect(label.getAttribute('tabindex')).toBe('0');
    });

    it('keeps the last steps while waiting for the server', () => {
      const { rerender } = render(<ProcessingStatusBanner {...base} currentPhase="Fase 1/3: trascrizione (chunk 4/6)" />);
      rerender(<ProcessingStatusBanner {...base} currentPhase="Rate limit: attendo 60s" />);
      expect(screen.getByText('Pausa automatica')).toBeTruthy();
      expect(states()).toEqual(['done', 'active', 'pending']);
    });
  });

  describe('estimated remaining time', () => {
    const base = {
      appState: 'processing' as const,
      currentPhase: 'Fase 1/3: trascrizione (chunk 3/6)',
      currentModel: 'gemini-2.5-flash',
      workDone: { chunks: 2, macro: 0 },
      workTotals: { chunks: 6, macro: 4 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'lesson.mp3',
    };

    it('stays hidden while the estimate would be noise', () => {
      const { rerender } = render(<ProcessingStatusBanner {...base} activeProgress={30} startedAt={Date.now() - 10_000} />);
      expect(screen.queryByTestId('remaining-time')).toBeNull();

      rerender(<ProcessingStatusBanner {...base} activeProgress={3} startedAt={Date.now() - 120_000} />);
      expect(screen.queryByTestId('remaining-time')).toBeNull();
    });

    it('shows an Italian estimate next to the elapsed time once meaningful', () => {
      render(<ProcessingStatusBanner {...base} activeProgress={50} startedAt={Date.now() - 120_000} />);
      expect(screen.getByText(/^Da 2m/)).toBeTruthy();
      expect(screen.getByTestId('remaining-time').textContent).toBe('circa 2 min rimanenti');
    });

    it('smooths a sudden progress jump instead of following it', () => {
      const startedAt = Date.now() - 120_000;
      const { rerender } = render(<ProcessingStatusBanner {...base} activeProgress={50} startedAt={startedAt} />);
      // A raw estimate would drop to 30 s; the smoothed one only moves part of the way.
      rerender(<ProcessingStatusBanner {...base} activeProgress={80} startedAt={startedAt} />);
      expect(screen.getByTestId('remaining-time').textContent).toBe('circa 2 min rimanenti');
    });

    it('hides the estimate while waiting or canceling', () => {
      const startedAt = Date.now() - 120_000;
      const { rerender } = render(<ProcessingStatusBanner {...base} activeProgress={50} startedAt={startedAt} />);
      expect(screen.getByTestId('remaining-time')).toBeTruthy();

      rerender(<ProcessingStatusBanner {...base} currentPhase="Server Gemini occupato — ritento tra 3s" activeProgress={50} startedAt={startedAt} />);
      expect(screen.queryByTestId('remaining-time')).toBeNull();

      rerender(<ProcessingStatusBanner {...base} currentPhase="Rate limit: attendo 60s" activeProgress={50} startedAt={startedAt} />);
      expect(screen.queryByTestId('remaining-time')).toBeNull();

      rerender(<ProcessingStatusBanner {...base} appState="canceling" activeProgress={50} startedAt={startedAt} />);
      expect(screen.queryByTestId('remaining-time')).toBeNull();
    });
  });
});
