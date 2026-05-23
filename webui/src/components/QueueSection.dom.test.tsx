import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileItem } from '../appState';
import { QueueSection } from './QueueSection';

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'f1',
    name: 'lezione.mp3',
    size: 1024,
    duration: 60,
    status: 'queued',
    progress: 0,
    phase: 0,
    ...overrides,
  };
}

const baseProps = {
  appState: 'idle' as const,
  autoContinue: false,
  setAutoContinue: vi.fn(),
  preferredModel: 'gemini-2.5-flash',
  queuedCount: 1,
  canStart: true,
  hasApiKey: true,
  isApiKeyValid: true,
  currentPhase: '',
  dndSensors: [],
  onDragEnd: vi.fn(),
  onRemove: vi.fn(),
  onClearAll: vi.fn(),
  onRetry: vi.fn(),
  onPreview: vi.fn(),
  onOpenFile: vi.fn(),
  onStart: vi.fn(),
  onStop: vi.fn(),
};

describe('QueueSection', () => {
  it('renders nothing when no pending files and appState is idle', () => {
    render(<QueueSection {...baseProps} pendingFiles={[]} queuedCount={0} />);
    expect(screen.queryByText('Coda di elaborazione')).toBeNull();
  });

  it('shows queue heading when files are present', () => {
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} />);
    expect(screen.getByText('Coda di elaborazione')).toBeTruthy();
  });

  it('shows file count pill', () => {
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} />);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows count for multiple files', () => {
    const files = [makeFile({ id: 'f1' }), makeFile({ id: 'f2' })];
    render(<QueueSection {...baseProps} pendingFiles={files} queuedCount={2} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows model pill without "Modello:" prefix', () => {
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} />);
    expect(screen.getByText('2.5-flash')).toBeTruthy();
    expect(screen.queryByText(/Modello:/)).toBeNull();
  });

  it('shows start button when idle with canStart', () => {
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} />);
    expect(screen.getByText(/Avvia sbobinatura/)).toBeTruthy();
  });

  it('calls onStart when start button is clicked', () => {
    const onStart = vi.fn();
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} onStart={onStart} />);
    fireEvent.click(screen.getByText(/Avvia sbobinatura/));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows API key warning when hasApiKey is false', () => {
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} hasApiKey={false} canStart={false} />);
    expect(screen.getByText(/Inserisci API Key/)).toBeTruthy();
  });

  it('shows invalid key warning when key is present but invalid', () => {
    render(
      <QueueSection
        {...baseProps}
        pendingFiles={[makeFile()]}
        hasApiKey isApiKeyValid={false} canStart={false}
      />,
    );
    expect(screen.getByText(/API Key non valida/)).toBeTruthy();
  });

  it('shows Stop button when processing', () => {
    render(
      <QueueSection
        {...baseProps}
        pendingFiles={[makeFile({ status: 'processing' })]}
        appState="processing"
      />,
    );
    expect(screen.getByText('Interrompi elaborazione')).toBeTruthy();
  });

  it('calls onStop when Stop button is clicked', () => {
    const onStop = vi.fn();
    render(
      <QueueSection
        {...baseProps}
        pendingFiles={[makeFile({ status: 'processing' })]}
        appState="processing"
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByText('Interrompi elaborazione'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows "Annullamento in corso" when canceling', () => {
    render(
      <QueueSection
        {...baseProps}
        pendingFiles={[makeFile({ status: 'processing' })]}
        appState="canceling"
      />,
    );
    expect(screen.getAllByText('Annullamento in corso...').length).toBeGreaterThan(0);
  });

  it('auto-continue toggle changes state and menu stays open', () => {
    const setAutoContinue = vi.fn();
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} setAutoContinue={setAutoContinue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni coda' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Coda automatica' }));
    expect(setAutoContinue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menuitem', { name: 'Coda automatica' })).toBeTruthy();
  });

  it('renders all files when more than 5 exist (no pagination button)', () => {
    const files = Array.from({ length: 7 }, (_, i) => makeFile({ id: `f${i}`, name: `file${i}.mp3` }));
    render(<QueueSection {...baseProps} pendingFiles={files} queuedCount={7} />);
    expect(screen.getByText('file6.mp3')).toBeTruthy();
    expect(screen.queryByText(/Mostra altri/)).toBeNull();
  });

  it('shows Svuota coda button when idle and files present', () => {
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni coda' }));
    expect(screen.getByRole('menuitem', { name: 'Svuota coda' })).toBeTruthy();
  });

  it('calls onClearAll when Svuota coda is clicked', () => {
    const onClearAll = vi.fn();
    render(<QueueSection {...baseProps} pendingFiles={[makeFile()]} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni coda' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Svuota coda' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('hides Svuota coda button when processing', () => {
    render(
      <QueueSection
        {...baseProps}
        pendingFiles={[makeFile({ status: 'processing' })]}
        appState="processing"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni coda' }));
    expect(screen.queryByRole('menuitem', { name: 'Svuota coda' })).toBeNull();
  });
});
