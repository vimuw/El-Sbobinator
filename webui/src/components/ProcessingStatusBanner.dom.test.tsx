import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProcessingStatusBanner } from './ProcessingStatusBanner';

describe('ProcessingStatusBanner', () => {
  it('shows the active revision section instead of 0/x', () => {
    render(
      <ProcessingStatusBanner
        appState="processing"
        currentPhase="Fase 2/3: revisione"
        currentModel="gemini-2.5-flash-lite"
        activeProgress={86}
        workDone={{ chunks: 8, macro: 0, boundary: 0 }}
        workTotals={{ chunks: 11, macro: 11, boundary: 10 }}
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
        currentModel="gemini-2.5-flash-lite"
        activeProgress={34}
        workDone={{ chunks: 1, macro: 0, boundary: 0 }}
        workTotals={{ chunks: 6, macro: 3, boundary: 2 }}
        currentFileIndex={0}
        currentBatchTotal={1}
        currentFileName="lesson.mp3"
      />,
    );

    expect(screen.getByText(/Normalizza l'audio/i)).toBeTruthy();
    expect(screen.getByText(/genera la prima sbobinatura dettagliata/i)).toBeTruthy();
    expect(screen.getByText(/ripulito, organizzato e reso piu' chiaro/i)).toBeTruthy();
    expect(screen.getByText(/evitare duplicati o sovrapposizioni/i)).toBeTruthy();
  });
});
