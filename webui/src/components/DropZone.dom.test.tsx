import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropOverlay, DropZone } from './DropZone';

const baseProps = {
  isDragging: false,
  onClick: vi.fn(),
};

describe('DropZone', () => {
  it('renders the browse text', () => {
    render(<DropZone {...baseProps} />);
    expect(screen.getByText('Trascina i file qui')).toBeTruthy();
  });

  it('summarises supported formats and keeps the full list in the tooltip', () => {
    render(<DropZone {...baseProps} />);
    const summary = screen.getByText('Audio o video · MP3, M4A, WAV, MP4 e altri');
    expect(summary.getAttribute('title')).toContain('.flac');
    expect(summary.getAttribute('title')).toContain('.aac');
  });

  it('shows Sfoglia file as decoration of the single card button, not a nested control', () => {
    render(<DropZone {...baseProps} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('Sfoglia file').getAttribute('aria-hidden')).toBe('true');
  });

  it('applies is-dragging class when isDragging is true', () => {
    const { container } = render(<DropZone {...baseProps} isDragging />);
    expect(container.querySelector('.is-dragging')).not.toBeNull();
  });

  it('does not apply is-dragging class when isDragging is false', () => {
    const { container } = render(<DropZone {...baseProps} />);
    expect(container.querySelector('.is-dragging')).toBeNull();
  });

  it('renders compact mode with correct text and supports keyboard Enter and Space', () => {
    const onClick = vi.fn();
    render(<DropZone {...baseProps} compact onClick={onClick} />);
    const compactDropZone = screen.getByRole('button');
    expect(compactDropZone).toBeTruthy();
    expect(screen.getByText('Trascina file o clicca per aggiungere')).toBeTruthy();

    // trigger onKeyDown other key
    fireEvent.keyDown(compactDropZone, { key: 'Escape' });
    expect(onClick).not.toHaveBeenCalled();

    // trigger onKeyDown Enter
    fireEvent.keyDown(compactDropZone, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);

    // trigger onKeyDown Space
    fireEvent.keyDown(compactDropZone, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('supports keyboard navigation in standard card mode', () => {
    const onClick = vi.fn();
    render(<DropZone {...baseProps} onClick={onClick} />);
    const dropZone = screen.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i });
    expect(dropZone).toBeTruthy();

    fireEvent.keyDown(dropZone, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dropZone, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('renders compact mode in dragging state', () => {
    render(<DropZone {...baseProps} compact isDragging />);
    expect(screen.getByText('Rilascia qui per aggiungere')).toBeTruthy();
  });

  it('sends the live ring from the icon only while a file hovers, in both sizes', () => {
    const { rerender } = render(<DropZone {...baseProps} />);
    expect(screen.queryByTestId('dropzone-ring')).toBeNull();
    rerender(<DropZone {...baseProps} isDragging />);
    expect(screen.getByTestId('dropzone-ring')).toBeTruthy();
    rerender(<DropZone {...baseProps} compact />);
    expect(screen.queryByTestId('dropzone-ring')).toBeNull();
    rerender(<DropZone {...baseProps} compact isDragging />);
    expect(screen.getByTestId('dropzone-ring')).toBeTruthy();
  });

  it('shows the live ring in the full-window overlay', () => {
    render(<DropOverlay visible />);
    expect(screen.getByTestId('dropzone-ring')).toBeTruthy();
  });
});
