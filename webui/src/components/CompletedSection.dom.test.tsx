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
  onRemove: vi.fn(),
  onPreview: vi.fn(),
  onOpenFile: vi.fn(),
};

describe('CompletedSection', () => {
  it('renders nothing when doneFiles is empty', () => {
    render(<CompletedSection {...baseProps} doneFiles={[]} />);
    expect(screen.queryByText('Recenti')).toBeNull();
  });

  it('renders the heading without a total count pill', () => {
    const files = [makeFile({ id: 'f1' }), makeFile({ id: 'f2' })];
    const { container } = render(<CompletedSection {...baseProps} doneFiles={files} />);
    expect(screen.getByText('Recenti')).toBeTruthy();
    expect(container.querySelector('.status-pill')).toBeNull();
  });

  it('has no bulk clear: Recenti rotates on its own', () => {
    render(<CompletedSection {...baseProps} doneFiles={[makeFile()]} />);
    expect(screen.queryByRole('button', { name: 'Pulisci tutto' })).toBeNull();
  });

  it('links to the archive without a count', () => {
    const onOpenArchive = vi.fn();
    render(<CompletedSection {...baseProps} doneFiles={[makeFile()]} onOpenArchive={onOpenArchive} />);
    fireEvent.click(screen.getByRole('button', { name: "Apri l'Archivio" }));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
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

  it('shows warnings in their own pill', () => {
    const files = [
      makeFile({ id: 'f1' }),
      makeFile({ id: 'f2', completionStatus: 'completed_with_warnings' }),
      makeFile({ id: 'f3', revisionFailedBlocks: [2] }),
    ];
    render(<CompletedSection {...baseProps} doneFiles={files} />);
    expect(screen.getByText('2 con avvisi').className).toContain('is-warning');
  });

  it('opens a completed transcript from its Apri button', () => {
    const onPreview = vi.fn();
    render(<CompletedSection {...baseProps} onPreview={onPreview} doneFiles={[makeFile({ outputHtml: '/out/l.html' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri' }));
    expect(onPreview).toHaveBeenCalledWith('/out/l.html', 'lezione.mp3', undefined, 'f1', undefined);
  });
});
