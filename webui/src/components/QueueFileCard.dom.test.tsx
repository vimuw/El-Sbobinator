import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { describe, expect, it, vi } from 'vitest';
import type { FileItem } from '../appState';
import { CompletedFileCard, QueueFileCard } from './QueueFileCard';

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'f1',
    name: 'lezione.mp3',
    size: 1024 * 1024,
    duration: 3600,
    status: 'queued',
    progress: 0,
    phase: 0,
    ...overrides,
  };
}

function QueueWrapper({ children }: { children: React.ReactNode }) {
  return (
    <DndContext>
      <SortableContext items={['f1']} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

describe('QueueFileCard', () => {
  it('renders file name', () => {
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile()} appState="idle" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
      </QueueWrapper>,
    );
    expect(screen.getByText('lezione.mp3')).toBeTruthy();
  });

  it('shows drag handle when idle+queued', () => {
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile()} appState="idle" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
      </QueueWrapper>,
    );
    expect(screen.getByLabelText('Trascina per riordinare')).toBeTruthy();
  });

  it('shows remove button when idle', () => {
    const onRemove = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile()} appState="idle" onRemove={onRemove} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
      </QueueWrapper>,
    );
    const btns = screen.getAllByRole('button');
    const removeBtn = btns.find(b => b.querySelector('svg'));
    expect(removeBtn).toBeTruthy();
  });

  it('shows "In elaborazione" chip when processing', () => {
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'processing' })}
          appState="processing"
          onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText('In elaborazione')).toBeTruthy();
  });

  it('shows "Annullamento in corso" chip when canceling', () => {
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'processing' })}
          appState="canceling"
          onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText('Annullamento in corso')).toBeTruthy();
  });

  it('shows Riprendi CTA for resumable error (quota) when idle', () => {
    const onRetry = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'error', errorText: 'quota_daily_limit_phase1' })}
          appState="idle"
          onRemove={vi.fn()} onRetry={onRetry} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText('Riprendi')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Riprendi'));
    expect(onRetry).toHaveBeenCalledWith('f1');
  });

  it('shows Riprendi CTA for regenerate prompt timeout when idle', () => {
    const onRetry = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'error', errorText: 'regenerate_prompt_timeout' })}
          appState="idle"
          onRemove={vi.fn()} onRetry={onRetry} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText(/Nessuna scelta/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Riprendi'));
    expect(onRetry).toHaveBeenCalledWith('f1');
  });

  it('shows Riprendi CTA for chunk_failed error when idle', () => {
    const onRetry = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'error', errorText: 'phase1_chunk_failed_3', errorDetail: 'FFmpeg error: disk full' })}
          appState="idle"
          onRemove={vi.fn()} onRetry={onRetry} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText(/FFmpeg error: disk full/)).toBeTruthy();
    expect(screen.getByText('Riprendi')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Riprendi'));
    expect(onRetry).toHaveBeenCalledWith('f1');
    expect(screen.queryByLabelText('Riprova')).toBeNull();
  });

  it('shows Riprova icon button for non-resumable error when idle', () => {
    const onRetry = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'error', errorText: 'html_export_failed' })}
          appState="idle"
          onRemove={vi.fn()} onRetry={onRetry} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    fireEvent.click(screen.getByLabelText('Riprova'));
    expect(onRetry).toHaveBeenCalledWith('f1');
    expect(screen.queryByLabelText('Riprendi')).toBeNull();
  });

  it('calls onRemove when trash button is clicked', () => {
    const onRemove = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile()} appState="idle" onRemove={onRemove} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
      </QueueWrapper>,
    );
    fireEvent.click(screen.getByRole('button', { hidden: true, name: '' }));
    expect(onRemove).toHaveBeenCalledWith('f1');
  });

  it('formats size and duration', () => {
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile()} appState="idle" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
      </QueueWrapper>,
    );
    expect(screen.getByText('1.0 MB')).toBeTruthy();
    expect(screen.getByText('1h 0m')).toBeTruthy();
  });
});

describe('CompletedFileCard', () => {
  it('renders file name with Nuovo badge for newest', () => {
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html' })}
        isNewest
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText('lezione.mp3')).toBeTruthy();
    expect(screen.getByText('Nuovo')).toBeTruthy();
  });

  it('shows kebab menu button when outputHtml is set', () => {
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Altre opzioni')).toBeTruthy();
  });

  it('calls onPreview when Modifica is clicked in kebab menu', () => {
    const onPreview = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Altre opzioni'));
    fireEvent.click(screen.getByText('Modifica'));
    expect(onPreview).toHaveBeenCalledWith('/out/file.html', 'lezione.mp3', undefined, 'f1', undefined);
  });

  it('calls onRemove when Rimuovi is clicked in kebab menu', () => {
    const onRemove = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done' })}
        isNewest={false}
        onRemove={onRemove} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Altre opzioni'));
    fireEvent.click(screen.getByText('Rimuovi'));
    expect(onRemove).toHaveBeenCalledWith('f1');
  });

  it('calls onPreview when card is clicked (isClickable)', () => {
    const onPreview = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html', path: '/src/f.mp3' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('lezione.mp3'));
    expect(onPreview).toHaveBeenCalledWith('/out/file.html', 'lezione.mp3', '/src/f.mp3', 'f1', undefined);
  });

  it('passes outputDir as sessionDir when previewing a completed file', () => {
    const onPreview = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html', outputDir: '/sessions/s1', path: '/src/f.mp3' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('lezione.mp3'));
    expect(onPreview).toHaveBeenCalledWith('/out/file.html', 'lezione.mp3', '/src/f.mp3', 'f1', '/sessions/s1');
  });

  it('renders the collection indicator for completed files', () => {
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        currentFolder={{ name: 'Corso A', color: '#4D96FF' }}
      />,
    );
    expect(screen.getByTitle('Raccolta: Corso A')).toBeTruthy();
  });

  it('calls onOpenFile when Apri nel browser is clicked in kebab menu', () => {
    const onOpenFile = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={onOpenFile}
      />,
    );
    fireEvent.click(screen.getByLabelText('Altre opzioni'));
    fireEvent.click(screen.getByText('Apri nel browser'));
    expect(onOpenFile).toHaveBeenCalledWith('/out/file.html');
  });

  it('shows fallback badge when primary and effective models differ', () => {
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', primaryModel: 'gemini-flash', effectiveModel: 'gemini-flash-lite' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText('fallback')).toBeTruthy();
  });
});
