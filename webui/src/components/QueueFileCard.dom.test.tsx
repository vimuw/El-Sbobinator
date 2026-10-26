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

  it('shows drag handle for error file when idle and showDragHandle is true', () => {
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile({ status: 'error', errorText: 'timeout' })} appState="idle" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} showDragHandle={true} />
      </QueueWrapper>,
    );
    expect(screen.getByLabelText('Trascina per riordinare')).toBeTruthy();
  });

  it('shows drag handle for paused file when idle and showDragHandle is true', () => {
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile({ status: 'paused', errorText: 'circuit_breaker_paused' })} appState="idle" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} showDragHandle={true} />
      </QueueWrapper>,
    );
    expect(screen.getByLabelText('Trascina per riordinare')).toBeTruthy();
  });

  it('hides drag handle when showDragHandle is false', () => {
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile()}
          appState="idle"
          onRemove={vi.fn()}
          onRetry={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          showDragHandle={false}
        />
      </QueueWrapper>,
    );
    expect(screen.queryByLabelText('Trascina per riordinare')).toBeNull();
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

  it('shows "In elaborazione" chip and is-processing class when processing', () => {
    const { container } = render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'processing' })}
          appState="processing"
          onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText('In elaborazione')).toBeTruthy();
    expect(container.querySelector('.is-processing')).toBeTruthy();
  });

  it('shows "Annullamento in corso" chip and is-canceling class when canceling', () => {
    const { container } = render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'processing' })}
          appState="canceling"
          onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText('Annullamento in corso')).toBeTruthy();
    expect(container.querySelector('.is-canceling')).toBeTruthy();
  });

  it('marks the processing file with a static indicator, leaving progress to the banner', () => {
    const { container } = render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'processing', isRetryingBlocks: true })}
          appState="processing"
          onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(container.querySelector('.animate-pulse, .animate-spin')).toBeNull();
  });

  it('shows the active file with the transcription icon and waiting files with a clock', () => {
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile({ id: 'f1', status: 'processing' })} appState="processing" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
        <QueueFileCard file={makeFile({ id: 'f2' })} appState="processing" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
      </QueueWrapper>,
    );
    expect(screen.getAllByTestId('queue-icon-active')).toHaveLength(1);
    expect(screen.getAllByTestId('queue-icon-waiting')).toHaveLength(1);
  });

  it('puts the drag handle in the status icon slot instead of reserving a column for it', () => {
    const { container } = render(
      <QueueWrapper>
        <QueueFileCard file={makeFile({ id: 'f1', status: 'processing' })} appState="processing" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} showDragHandle />
        <QueueFileCard file={makeFile({ id: 'f2' })} appState="processing" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} showDragHandle />
      </QueueWrapper>,
    );
    expect(container.querySelector('.drag-handle-spacer')).toBeNull();
    const [activeSlot, queuedSlot] = Array.from(container.querySelectorAll('.queue-icon-slot'));
    expect(activeSlot.classList.contains('has-handle')).toBe(false);
    expect(activeSlot.querySelector('.drag-handle-btn')).toBeNull();
    expect(queuedSlot.classList.contains('has-handle')).toBe(true);
    const handle = screen.getByLabelText('Trascina per riordinare');
    expect(handle.parentElement).toBe(queuedSlot);
    expect(queuedSlot.querySelector('[data-testid="queue-icon-waiting"]')).toBeTruthy();
  });

  it('keeps the drag handle inside the queue item so it can stay hidden until hover or focus', () => {
    const { container } = render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile()}
          appState="idle"
          onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    const handle = screen.getByLabelText('Trascina per riordinare');
    expect(handle.closest('.queue-item')).toBe(container.querySelector('.queue-item'));
    expect(handle.classList.contains('drag-handle-btn')).toBe(true);
  });

  it('puts size and duration in a meta line under the file name', () => {
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile()}
          appState="idle"
          onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    const name = screen.getByRole('heading', { name: 'lezione.mp3' });
    const meta = name.nextElementSibling as HTMLElement;
    expect(meta.classList.contains('queue-card-meta')).toBe(true);
    expect(meta.textContent).toContain('1h 0m');
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
    expect(screen.getByLabelText('Riprendi')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Riprendi'));
    expect(onRetry).toHaveBeenCalledWith('f1');
  });

  it('shows Riprendi CTA for a circuit-breaker paused file', () => {
    const onRetry = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'paused', retryable: true, retryReason: 'circuit_breaker_paused' })}
          appState="idle"
          onRemove={vi.fn()} onRetry={onRetry} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );

    fireEvent.click(screen.getByLabelText('Riprendi'));
    expect(onRetry).toHaveBeenCalledWith('f1');
  });

  it('shows Riprendi CTA and warning badge styling for regenerate prompt timeout when idle', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <QueueWrapper>
        <QueueFileCard
          file={makeFile({ status: 'error', errorText: 'regenerate_prompt_timeout' })}
          appState="idle"
          onRemove={vi.fn()} onRetry={onRetry} onPreview={vi.fn()} onOpenFile={vi.fn()}
        />
      </QueueWrapper>,
    );
    expect(screen.getByText(/Nessuna scelta/)).toBeTruthy();
    expect(container.querySelector('.is-warning')).toBeTruthy();
    expect(container.querySelector('.is-error')).toBeNull();
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
    expect(screen.getByLabelText('Riprendi')).toBeTruthy();
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

  it('calls onRemove when remove button is clicked', () => {
    const onRemove = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile()} appState="idle" onRemove={onRemove} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />
      </QueueWrapper>,
    );
    fireEvent.click(screen.getByLabelText('Rimuovi'));
    expect(onRemove).toHaveBeenCalledWith('f1');
  });

  it('shows drag handle and remove button for queued file during processing', () => {
    const onRemove = vi.fn();
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile({ status: 'queued' })} appState="processing" onRemove={onRemove} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} showDragHandle={true} />
      </QueueWrapper>,
    );
    expect(screen.getByLabelText('Trascina per riordinare')).toBeTruthy();
    expect(screen.getByLabelText('Rimuovi')).toBeTruthy();
  });

  it('does not show drag handle or remove button for actively processing file', () => {
    render(
      <QueueWrapper>
        <QueueFileCard file={makeFile({ status: 'processing' })} appState="processing" onRemove={vi.fn()} onRetry={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} showDragHandle={true} />
      </QueueWrapper>,
    );
    expect(screen.queryByLabelText('Trascina per riordinare')).toBeNull();
    expect(screen.queryByLabelText('Rimuovi')).toBeNull();
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
  it('shows and opens the archive title when the session was renamed', () => {
    const onPreview = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html', title: 'Cardio 1' })}
        onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText('Cardio 1')).toBeTruthy();
    expect(screen.queryByText('lezione.mp3')).toBeNull();
    fireEvent.click(screen.getByLabelText("Apri Cardio 1 nell'editor"));
    expect(onPreview.mock.calls[0][1]).toBe('Cardio 1');
  });

  it('renders completed file card with name and details', () => {
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html' })}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText('lezione.mp3')).toBeTruthy();
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

  it('opens the editor from Apri and does not repeat it in the kebab menu', () => {
    const onPreview = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Apri/ }));
    expect(onPreview).toHaveBeenCalledWith('/out/file.html', 'lezione.mp3', undefined, 'f1', undefined);
    fireEvent.click(screen.getByLabelText('Altre opzioni'));
    expect(screen.queryByText('Modifica')).toBeNull();
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

  it('offers Apri cartella but not Apri nel browser in the kebab menu', () => {
    const onOpenFile = vi.fn();
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html', outputDir: '/out' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={onOpenFile}
      />,
    );
    fireEvent.click(screen.getByLabelText('Altre opzioni'));
    expect(screen.queryByText('Apri nel browser')).toBeNull();
    fireEvent.click(screen.getByText('Apri cartella'));
    expect(onOpenFile).toHaveBeenCalledWith('/out');
  });

  it('shows the effective model for a regenerated legacy queue entry without a fallback badge', () => {
    render(
      <CompletedFileCard
        file={makeFile({ status: 'done', effectiveModel: 'gemini-2.5-flash' })}
        isNewest={false}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText('2.5-flash')).toBeTruthy();
    expect(screen.queryByText('3.6-flash')).toBeNull();
    expect(screen.queryByText(/fallback/i)).toBeNull();
  });
});

describe('CompletedFileCard fresh highlight', () => {
  it('highlights a sbobina that has just finished', () => {
    const { container } = render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html', completedAt: Date.now() })}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    expect(container.querySelector('.queue-card.is-fresh')).toBeTruthy();
  });

  it('does not highlight completions restored from an earlier run', () => {
    const { container } = render(
      <CompletedFileCard
        file={makeFile({ status: 'done', outputHtml: '/out/file.html', completedAt: Date.now() - 60_000 })}
        onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()}
      />,
    );
    expect(container.querySelector('.queue-card.is-fresh')).toBeNull();
  });
});

describe('CompletedFileCard open affordance', () => {
  const openableFile = () => makeFile({ status: 'done', outputHtml: '/out/file.html', path: '/src/f.mp3', outputDir: '/sessions/s1' });

  it('shows an Apri button that opens the editor once, next to the kebab menu', () => {
    const onPreview = vi.fn();
    render(<CompletedFileCard file={openableFile()} onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()} />);
    const openButton = screen.getByRole('button', { name: 'Apri' });
    expect(openButton.className).toContain('completed-open-button');
    expect(screen.getByLabelText('Altre opzioni')).toBeTruthy();
    fireEvent.click(openButton);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith('/out/file.html', 'lezione.mp3', '/src/f.mp3', 'f1', '/sessions/s1');
  });

  it('makes the card focusable and opens the editor with Enter or Space', () => {
    const onPreview = vi.fn();
    const { container } = render(<CompletedFileCard file={openableFile()} onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()} />);
    const card = container.querySelector('.queue-card') as HTMLElement;
    expect(card.tabIndex).toBe(0);
    expect(card.getAttribute('aria-label')).toBe("Apri lezione.mp3 nell'editor");
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it('leaves Enter on inner buttons to their own action', () => {
    const onPreview = vi.fn();
    render(<CompletedFileCard file={openableFile()} onRemove={vi.fn()} onPreview={onPreview} onOpenFile={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText('Altre opzioni'), { key: 'Enter' });
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('offers no open affordance or focus stop without an output', () => {
    const { container } = render(<CompletedFileCard file={makeFile({ status: 'done' })} onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Apri' })).toBeNull();
    expect((container.querySelector('.queue-card') as HTMLElement).hasAttribute('tabindex')).toBe(false);
  });

  it('keeps the meta line quiet and the warning prominent', () => {
    const { container, rerender } = render(
      <CompletedFileCard file={makeFile({ status: 'done', outputHtml: '/out/file.html', completedAt: Date.now() - 3_600_000 })} onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />,
    );
    const meta = container.querySelector('.queue-card-meta') as HTMLElement;
    expect(meta).toBeTruthy();
    expect(meta.innerHTML).not.toContain('--success-text');
    rerender(
      <CompletedFileCard file={makeFile({ status: 'done', outputHtml: '/out/file.html', completionStatus: 'completed_with_warnings', revisionFailedBlocks: [2] })} onRemove={vi.fn()} onPreview={vi.fn()} onOpenFile={vi.fn()} />,
    );
    expect(screen.getByText('Completata con avvisi').className).toContain('--warning-text');
    expect(screen.getByText(/1 blocco non revisionato/).className).toContain('--warning-text');
  });
});
