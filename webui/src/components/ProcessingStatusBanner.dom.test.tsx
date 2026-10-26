import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('lists the block counter with the run details, not beside the file name', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 1/3: trascrizione (chunk 3/12)"
        currentModel="gemini-2.5-flash"
        activeProgress={20}
        workDone={{ chunks: 2, macro: 0 }}
        workTotals={{ chunks: 12, macro: 0 }}
        currentFileIndex={0}
        currentBatchTotal={5}
        currentFileName="Fisiologia II Lezione 3 pt 2.m4a"
        startedAt={Date.now() - 30_000}
      />,
    );
    expect(screen.getByTestId('processing-file-name').textContent).toBe('Fisiologia II Lezione 3 pt 2.m4a');
    const meta = screen.getByTestId('processing-meta').textContent ?? '';
    expect(meta).toMatch(/^File 1 di 5Blocco 3 di 122\.5-flash/);
  });

  it('fills the transcription segment as chunks complete', () => {
    const props = {
      appState: 'processing' as const,
      currentPhase: 'Fase 1/3: trascrizione (chunk 5/10)',
      currentModel: 'gemini-2.5-flash',
      activeProgress: 28,
      workTotals: { chunks: 10, macro: 0 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
    };
    const { rerender } = render(<ProcessingStatusBanner {...props} workDone={{ chunks: 0, macro: 0 }} />);
    const segment = screen.getByTestId('phase-segment-trascrizione');
    expect(segment.getAttribute('data-state')).toBe('active');
    rerender(<ProcessingStatusBanner {...props} workDone={{ chunks: 4, macro: 0 }} />);
    return waitFor(() => {
      const fill = segment.firstElementChild as HTMLElement;
      expect(parseFloat(fill.style.width)).toBeGreaterThan(20);
    });
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

  it('titles the banner with the step and shows the file underneath', () => {
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
    expect(screen.getByText('lesson.mp3')).toBeTruthy();

    // The next step shows immediately instead of leaving the title empty.
    rerender(<ProcessingStatusBanner {...props} activeProgress={2} currentPhase="Fase 0/3: pre-conversione audio" />);
    expect(screen.getByText('Pre-conversione audio')).toBeTruthy();
  });

  it('keeps the step as heading when the file name is unknown', () => {
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

  it('animates only while a step runs and draws the check on success', () => {
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
    expect(screen.getByTestId('processing-ping')).toBeTruthy();
    expect(screen.getByTestId('step-live-dot')).toBeTruthy();
    expect(screen.getByTestId('phase-segment-trascrizione').querySelector('.phase-segment-fill.is-live')).toBeTruthy();
    expect(screen.getByTestId('phase-segment-preconversione').querySelector('.is-live')).toBeNull();
    expect(screen.getByTestId('progress-percent').textContent).toBe('40%');

    // A wait keeps the step on screen but stops the live motion.
    rerender(<ProcessingStatusBanner {...props} currentPhase="Server Gemini occupato (503). Nuovo tentativo tra 20s" activeProgress={40} />);
    expect(screen.queryByTestId('processing-ping')).toBeNull();
    expect(container.querySelector('.phase-segment-fill.is-live')).toBeNull();

    rerender(<ProcessingStatusBanner {...props} appState="canceling" currentPhase="Fase 1/3: trascrizione (chunk 2/4)" activeProgress={40} />);
    expect(screen.queryByTestId('processing-ping')).toBeNull();
    expect(screen.queryByTestId('step-live-dot')).toBeNull();

    rerender(<ProcessingStatusBanner {...props} currentPhase="__completed__" activeProgress={100} />);
    expect(screen.getByTestId('drawn-check')).toBeTruthy();
    expect(screen.queryByTestId('processing-ping')).toBeNull();
    expect(container.querySelector('.is-live')).toBeNull();
  });

  it('settles only the step that finishes while the banner is on screen', () => {
    const props = {
      appState: 'processing' as const,
      currentModel: 'gemini-2.5-flash',
      workDone: { chunks: 0, macro: 0 },
      workTotals: { chunks: 4, macro: 2 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'lesson.mp3',
    };
    const { container, rerender } = render(
      <ProcessingStatusBanner {...props} currentPhase="Fase 0/3: pre-conversione audio" activeProgress={1} />,
    );
    expect(container.querySelector('.is-settled')).toBeNull();

    rerender(<ProcessingStatusBanner {...props} currentPhase="Fase 1/3: trascrizione (chunk 1/4)" activeProgress={3} />);
    const preconversione = screen.getByTestId('phase-segment-preconversione');
    expect(preconversione.classList.contains('is-settled')).toBe(true);
    expect(preconversione.querySelector('.phase-segment-fill.is-settled')).toBeTruthy();
    expect(screen.getAllByTestId('step-drawn-check')).toHaveLength(1);
    // The check, not the label, carries the step accent.
    expect(screen.getByTestId('step-drawn-check').getAttribute('style')).toContain('var(--processing-text)');

    // A wait in between keeps the same steps, so nothing settles again.
    rerender(<ProcessingStatusBanner {...props} currentPhase="Server Gemini occupato (503). Nuovo tentativo tra 20s" activeProgress={3} />);
    expect(container.querySelectorAll('.phase-segment.is-settled')).toHaveLength(1);

    rerender(<ProcessingStatusBanner {...props} currentPhase="Fase 2/3: revisione (blocco 1/2)" activeProgress={72} />);
    expect(screen.getByTestId('phase-segment-trascrizione').querySelector('.is-settled')).toBeTruthy();
    expect(screen.getByTestId('phase-segment-preconversione').querySelector('.is-settled')).toBeNull();
  });

  it('starts filling the next step only after the finished one has closed', async () => {
    const props = {
      appState: 'processing' as const,
      currentModel: 'gemini-2.5-flash',
      workTotals: { chunks: 4, macro: 2 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
    };
    const { rerender } = render(
      <ProcessingStatusBanner {...props} currentPhase="Fase 0/3: pre-conversione audio" activeProgress={1} workDone={{ chunks: 0, macro: 0 }} />,
    );
    expect(screen.getByTestId('phase-segment-trascrizione').getAttribute('data-waiting')).toBeNull();

    rerender(<ProcessingStatusBanner {...props} currentPhase="Fase 1/3: trascrizione (chunk 1/4)" activeProgress={3} workDone={{ chunks: 0, macro: 0 }} />);
    expect(screen.getByTestId('phase-segment-trascrizione').getAttribute('data-waiting')).toBe('true');
    expect(screen.getByTestId('phase-segment-preconversione').getAttribute('data-waiting')).toBeNull();

    // Once the handoff is over, later progress fills right away.
    await waitFor(() => expect(screen.getByTestId('phase-segment-trascrizione').getAttribute('data-waiting')).toBeNull());
  });

  it('keeps steps already done at mount still', () => {
    const { container } = render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 2/3: revisione (blocco 1/2)"
        currentModel="gemini-2.5-flash"
        activeProgress={72}
        workDone={{ chunks: 4, macro: 0 }}
        workTotals={{ chunks: 4, macro: 2 }}
        currentFileIndex={0}
        currentBatchTotal={1}
      />,
    );
    expect(container.querySelector('.is-settled')).toBeNull();
    expect(screen.queryByTestId('step-drawn-check')).toBeNull();
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

  describe('lasting warnings', () => {
    const base = {
      appState: 'processing' as const,
      currentPhase: 'Fase 2/3: revisione (2/4)',
      currentModel: 'gemini-3.8-flash',
      activeProgress: 80,
      workDone: { chunks: 7, macro: 1 },
      workTotals: { chunks: 7, macro: 4 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'lesson.mp3',
    };

    it('lists every warning of the run alongside a live notice', () => {
      render(
        <ProcessingStatusBanner
          {...base}
          currentPhase="Server Gemini occupato — riprovo tra 15s (tentativo 2/5)"
          warnings={[
            { code: 'preconversion_failed', message: 'Pre-conversione audio non riuscita: continuo con il file originale' },
            { code: 'fallback_key_in_use', message: 'Quota della chiave principale esaurita: continuo con una chiave di riserva' },
          ]}
        />,
      );
      const list = screen.getByRole('list', { name: 'Avvisi elaborazione' });
      expect(Array.from(list.querySelectorAll('li')).map(item => item.textContent)).toEqual([
        'Pre-conversione audio non riuscita: continuo con il file originale',
        'Quota della chiave principale esaurita: continuo con una chiave di riserva',
      ]);
      expect(screen.getByTestId('processing-notice')).toBeTruthy();
    });

    it('keeps warnings visible on completion and hides the list when there are none', () => {
      const { rerender } = render(<ProcessingStatusBanner {...base} />);
      expect(screen.queryByTestId('processing-warnings')).toBeNull();

      rerender(
        <ProcessingStatusBanner
          {...base}
          currentPhase="__completed__"
          activeProgress={100}
          warnings={[{ code: 'unrevised_blocks', message: '1 sezione inclusa senza revisione (sezione 2)' }]}
        />,
      );
      expect(screen.getByText('1 sezione inclusa senza revisione (sezione 2)')).toBeTruthy();
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
  describe('stop action', () => {
    const base = {
      currentModel: 'gemini-2.5-flash',
      activeProgress: 30,
      workDone: { chunks: 1, macro: 0 },
      workTotals: { chunks: 4, macro: 2 },
      currentFileIndex: 0,
      currentBatchTotal: 1,
      currentFileName: 'lesson.mp3',
    };

    it('stops the run from the banner while processing', () => {
      const onStop = vi.fn();
      render(<ProcessingStatusBanner {...base} appState="processing" currentPhase="Fase 1/3: trascrizione (chunk 2/4)" onStop={onStop} />);
      fireEvent.click(screen.getByRole('button', { name: 'Interrompi' }));
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('shows a disabled pending state while canceling', () => {
      render(<ProcessingStatusBanner {...base} appState="canceling" currentPhase="Fase 1/3: trascrizione (chunk 2/4)" onStop={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Interrompi' })).toBeNull();
      expect((screen.getByRole('button', { name: 'Annullamento in corso...' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('offers no stop once the file is completed', () => {
      render(<ProcessingStatusBanner {...base} appState="processing" currentPhase="__completed__" activeProgress={100} onStop={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Interrompi' })).toBeNull();
    });
  });
});
