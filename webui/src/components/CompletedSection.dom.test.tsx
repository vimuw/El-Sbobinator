import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileItem } from '../appState';
import { CompletedSection } from './CompletedSection';

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'f1',
    name: 'lezione.mp3',
    size: 1024,
    duration: 60,
    status: 'done',
    progress: 100,
    phase: 3,
    ...overrides,
  };
}

const baseProps = {
  appState: 'idle' as const,
  onRemove: vi.fn(),
  onPreview: vi.fn(),
  onOpenFile: vi.fn(),
  onClearAll: vi.fn(),
};

describe('CompletedSection', () => {
  it('renders nothing when doneFiles is empty', () => {
    render(<CompletedSection {...baseProps} doneFiles={[]} />);
    expect(screen.queryByText('Recenti')).toBeNull();
  });

  it('renders heading and file count when files are present', () => {
    render(<CompletedSection {...baseProps} doneFiles={[makeFile()]} />);
    expect(screen.getByText('Recenti')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows correct count for multiple files', () => {
    const files = [makeFile({ id: 'f1' }), makeFile({ id: 'f2' })];
    render(<CompletedSection {...baseProps} doneFiles={files} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders "Pulisci tutto" button when appState is idle', () => {
    render(<CompletedSection {...baseProps} doneFiles={[makeFile()]} appState="idle" />);
    expect(screen.getByLabelText('Pulisci tutto')).toBeTruthy();
  });

  it('renders "Pulisci tutto" during processing too', () => {
    render(<CompletedSection {...baseProps} doneFiles={[makeFile()]} appState="processing" />);
    expect(screen.getByLabelText('Pulisci tutto')).toBeTruthy();
  });

  it('calls onClearAll when Pulisci tutto is clicked', () => {
    const onClearAll = vi.fn();
    render(<CompletedSection {...baseProps} doneFiles={[makeFile()]} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByLabelText('Pulisci tutto'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('shows only the latest files up to the limit and links the rest to the archive', () => {
    const onOpenArchive = vi.fn();
    const files = Array.from({ length: 5 }, (_, i) => makeFile({ id: `f${i}`, name: `file-${i}.mp3` }));
    render(<CompletedSection {...baseProps} doneFiles={files} limit={3} onOpenArchive={onOpenArchive} />);
    expect(screen.getByText('file-0.mp3')).toBeTruthy();
    expect(screen.getByText('file-2.mp3')).toBeTruthy();
    expect(screen.queryByText('file-3.mp3')).toBeNull();
    // The count still reflects every completed file, not just the visible ones.
    expect(screen.getByText('5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Vedi tutte \(5\) nell'Archivio/ }));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it('offers the archive without a count when every file fits', () => {
    render(<CompletedSection {...baseProps} doneFiles={[makeFile()]} limit={3} onOpenArchive={vi.fn()} />);
    expect(screen.getByRole('button', { name: "Apri l'Archivio" })).toBeTruthy();
  });

  it('has no search field: searching lives in the archive', () => {
    const files = Array.from({ length: 6 }, (_, i) => makeFile({ id: `f${i}`, name: `file-${i}.mp3` }));
    render(<CompletedSection {...baseProps} doneFiles={files} />);
    expect(screen.queryByPlaceholderText('Cerca...')).toBeNull();
  });

  it('passes folder indicators to completed cards by outputDir', () => {
    const sessionFolderMap = new Map([
      ['/sessions/s1', { id: 'folder-1', name: 'Corso A', color: '#4D96FF', session_dirs: ['/sessions/s1'] }],
    ]);
    render(
      <CompletedSection
        {...baseProps}
        doneFiles={[makeFile({ outputDir: '/sessions/s1', outputHtml: '/sessions/s1/out.html' })]}
        sessionFolderMap={sessionFolderMap}
      />,
    );
    expect(screen.getByTitle('Raccolta: Corso A')).toBeTruthy();
  });

  it('renders a bounded scrollable container for completed items with natural scroll chaining', () => {
    const { container } = render(
      <CompletedSection
        {...baseProps}
        doneFiles={[makeFile()]}
      />,
    );
    const scrollContainer = container.querySelector('.overflow-y-auto.app-scroll.is-chainable');
    expect(scrollContainer).toBeTruthy();
    expect(scrollContainer?.className).toContain('max-h-[390px]');
  });

  it('shows warnings in their own pill and Pulisci tutto as a labelled secondary action', () => {
    const files = [makeFile({ id: 'f1' }), makeFile({ id: 'f2', completionStatus: 'completed_with_warnings' })];
    render(<CompletedSection {...baseProps} doneFiles={files} />);
    expect(screen.getByText('1').className).toContain('is-quiet');
    expect(screen.getByText('1 con avvisi').className).toContain('is-warning');
    const clear = screen.getByRole('button', { name: 'Pulisci tutto' });
    expect(clear.className).toContain('queue-text-button');
    expect(clear.textContent).toContain('Pulisci tutto');
  });

  it('opens a completed transcript from its Apri button', () => {
    const onPreview = vi.fn();
    render(<CompletedSection {...baseProps} onPreview={onPreview} doneFiles={[makeFile({ outputHtml: '/out/l.html' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    expect(onPreview).toHaveBeenCalledWith('/out/l.html', 'lezione.mp3', undefined, 'f1', undefined);
  });
});
