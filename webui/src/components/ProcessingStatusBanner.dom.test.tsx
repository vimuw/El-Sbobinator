import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('titles the banner with the file and shows the step underneath', () => {
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
    expect(screen.getByRole('heading', { name: 'lesson.mp3' })).toBeTruthy();
    expect(screen.getByTestId('processing-step-title').textContent).toBe('Preparazione...');

    // The next step shows immediately instead of leaving the subtitle empty.
    rerender(<ProcessingStatusBanner {...props} activeProgress={2} currentPhase="Fase 0/3: pre-conversione audio" />);
    expect(screen.getByText('Pre-conversione audio')).toBeTruthy();
  });

  it('falls back to the step as heading when the file name is unknown', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 1/3: trascrizione (chunk 2/6)"
        currentModel="gemini-2.5-flash"
        activeProgress={20}
        workDone={{ chunks: 1, macro: 0 }}
        workTotals={{ chunks: 6, macro: 3 }}
        currentFileIndex={0}
        currentBatchTotal={1}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Trascrizione e sbobinatura' })).toBeTruthy();
    expect(screen.getByText('Blocco 2 di 6')).toBeTruthy();
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
      rerender(<ProcessingStatusBanner {...base} currentPhase="⏳ Rate limit: attesa 60s prima della sonda..." />);
      expect(screen.getByText('Limite di richieste al minuto raggiunto')).toBeTruthy();
      expect(states()).toEqual(['done', 'active', 'pending']);
    });
  });

  describe('elapsed time', () => {
    it('shows only the time spent, never an estimate of what is left', () => {
      render(
        <ProcessingStatusBanner
          appState="processing"
          currentPhase="Fase 1/3: trascrizione (chunk 3/6)"
          currentModel="gemini-2.5-flash"
          activeProgress={50}
          workDone={{ chunks: 2, macro: 0 }}
          workTotals={{ chunks: 6, macro: 4 }}
          currentFileIndex={0}
          currentBatchTotal={1}
          currentFileName="lesson.mp3"
          startedAt={Date.now() - 120_000}
        />,
      );
      expect(screen.getByText('2m 00s trascorsi')).toBeTruthy();
      expect(screen.queryByText(/rimanent/i)).toBeNull();
    });
  });

  describe('recoverable problems', () => {
    const base = {
      appState: 'processing' as const,
      currentModel: 'gemini-3.8-flash',
      activeProgress: 60,
      workDone: { chunks: 6, macro: 0 },
      workTotals: { chunks: 7, macro: 4 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'IMMUNOLOGIA 1, LEZIONE 4.mp3',
    };
    const step = 'Fase 1/3: trascrizione (chunk 7/7)';

    afterEach(() => { vi.useRealTimers(); });

    it.each([
      ['Risposta vuota da Gemini — riprovo tra 30s (tentativo 2/4)', 'Gemini ha restituito una risposta vuota', 'nuovo tentativo tra 30s · tentativo 2 di 4'],
      ['Errore temporaneo di Gemini — riprovo tra 30s (tentativo 3/4)', 'Errore temporaneo di Gemini', 'nuovo tentativo tra 30s · tentativo 3 di 4'],
      ['Server Gemini occupato — riprovo tra 15s (tentativo 2/5)', 'Server Gemini sovraccarico', 'nuovo tentativo tra 15s · tentativo 2 di 5'],
      ['⏳ Rate limit: attesa 65s prima della sonda...', 'Limite di richieste al minuto raggiunto', 'ripresa tra 65s'],
      ['Connessione assente — verifica rete in corso (riprovo ogni 10s)...', 'Connessione internet assente', 'riprendo appena torna la rete'],
      ['Output non valido nel blocco 7 — rigenero il blocco', 'Output non valido nel blocco 7', 'rigenero il blocco'],
    ])('explains "%s" without losing the interrupted step', async (phase, label, detail) => {
      const { rerender } = render(<ProcessingStatusBanner {...base} currentPhase={step} />);
      expect(screen.queryByTestId('processing-notice')).toBeNull();

      rerender(<ProcessingStatusBanner {...base} currentPhase={phase} />);
      expect(screen.getByRole('status').textContent).toBe(label);
      expect(screen.getByTestId('processing-notice').textContent).toBe(`${label} — ${detail}`);
      expect(screen.getByText('Trascrizione e sbobinatura')).toBeTruthy();
      expect(screen.getByText('Blocco 7 di 7')).toBeTruthy();

      rerender(<ProcessingStatusBanner {...base} currentPhase={step} />);
      await waitFor(() => expect(screen.queryByTestId('processing-notice')).toBeNull());
    });

    it('still names the interrupted step when it mounts during a problem', () => {
      render(<ProcessingStatusBanner {...base} currentPhase="Server Gemini occupato — riprovo tra 15s (tentativo 2/5)" />);
      expect(screen.getByText('Trascrizione e sbobinatura')).toBeTruthy();
      expect(screen.getByText('Blocco 7 di 7')).toBeTruthy();
      expect(screen.getByTestId('phase-segment-trascrizione').getAttribute('data-state')).toBe('active');
    });

    it('counts down the wait and says when the retry starts', () => {
      vi.useFakeTimers();
      const { rerender } = render(<ProcessingStatusBanner {...base} currentPhase={step} />);
      rerender(<ProcessingStatusBanner {...base} currentPhase="Risposta vuota da Gemini — riprovo tra 3s (tentativo 2/4)" />);
      expect(screen.getByTestId('processing-notice').textContent).toContain('nuovo tentativo tra 3s');

      act(() => { vi.advanceTimersByTime(2_000); });
      expect(screen.getByTestId('processing-notice').textContent).toContain('nuovo tentativo tra 1s');

      act(() => { vi.advanceTimersByTime(2_000); });
      expect(screen.getByTestId('processing-notice').textContent).toContain('nuovo tentativo in corso…');
    });

    it('restarts the countdown for the next attempt', () => {
      vi.useFakeTimers();
      const { rerender } = render(<ProcessingStatusBanner {...base} currentPhase="Server Gemini occupato — riprovo tra 15s (tentativo 2/5)" />);
      act(() => { vi.advanceTimersByTime(10_000); });
      rerender(<ProcessingStatusBanner {...base} currentPhase="Server Gemini occupato — riprovo tra 30s (tentativo 3/5)" />);
      expect(screen.getByTestId('processing-notice').textContent).toBe(
        'Server Gemini sovraccarico — nuovo tentativo tra 30s · tentativo 3 di 5',
      );
    });

    it('dims the progress only while the run is actually waiting', () => {
      const { container, rerender } = render(<ProcessingStatusBanner {...base} currentPhase={step} />);
      rerender(<ProcessingStatusBanner {...base} currentPhase="Errore temporaneo di Gemini — riprovo tra 30s (tentativo 2/4)" />);
      expect(container.querySelector('[data-waiting]')).toBeTruthy();

      rerender(<ProcessingStatusBanner {...base} currentPhase="Output non valido nel blocco 7 — rigenero il blocco" />);
      expect(container.querySelector('[data-waiting]')).toBeNull();
    });

    it('hides the notice while canceling', async () => {
      const phase = 'Errore temporaneo di Gemini — riprovo tra 30s (tentativo 2/4)';
      const { rerender } = render(<ProcessingStatusBanner {...base} currentPhase={phase} />);
      rerender(<ProcessingStatusBanner {...base} appState="canceling" currentPhase={phase} />);
      await waitFor(() => expect(screen.queryByTestId('processing-notice')).toBeNull());
      expect(screen.getByText('Interruzione in corso...')).toBeTruthy();
    });
  });
});
