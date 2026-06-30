import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropZone } from './DropZone';

const baseProps = {
  isDragging: false,
  onDragOver: vi.fn(),
  onDragLeave: vi.fn(),
  onDrop: vi.fn(),
  onClick: vi.fn(),
};

describe('DropZone', () => {
  it('renders the browse text', () => {
    render(<DropZone {...baseProps} />);
    expect(screen.getByText('Trascina i file qui')).toBeTruthy();
  });

  it('mentions supported formats', () => {
    render(<DropZone {...baseProps} />);
    expect(screen.getByText(/\.mp3/)).toBeTruthy();
  });

  it('applies is-dragging class when isDragging is true', () => {
    const { container } = render(<DropZone {...baseProps} isDragging />);
    expect(container.querySelector('.is-dragging')).not.toBeNull();
  });

  it('does not apply is-dragging class when isDragging is false', () => {
    const { container } = render(<DropZone {...baseProps} />);
    expect(container.querySelector('.is-dragging')).toBeNull();
  });

  it('renders compact mode with correct text and supports keyboard Enter', () => {
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
  });

  it('renders compact mode in dragging state', () => {
    render(<DropZone {...baseProps} compact isDragging />);
    expect(screen.getByText('Rilascia qui per aggiungere')).toBeTruthy();
  });
});
