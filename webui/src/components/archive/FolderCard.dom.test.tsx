import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveFolder } from '../../bridge';
import { SortableFolderCard } from './FolderCard';

const { sortableKeyDown, sortable } = vi.hoisted(() => ({ sortableKeyDown: vi.fn(), sortable: { isDragging: false } }));

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: { role: 'button', tabIndex: 0 },
    listeners: { onKeyDown: sortableKeyDown },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: sortable.isDragging,
  }),
}));

const folder: ArchiveFolder = { id: 'f1', name: 'Istologia', color: '#3d6b3a', session_dirs: [] };

const renderCard = (onNavigate = vi.fn()) => {
  const { container } = render(
    <SortableFolderCard folder={folder} sessionsByDir={new Map()} onNavigate={onNavigate} onEdit={vi.fn()} onDelete={vi.fn()} />,
  );
  return { card: container.firstElementChild as HTMLElement, onNavigate };
};

describe('SortableFolderCard keyboard', () => {
  beforeEach(() => {
    sortableKeyDown.mockClear();
    sortable.isDragging = false;
  });

  it('opens the folder on Enter and leaves Space to reordering', () => {
    const { card, onNavigate } = renderCard();

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(card, { key: ' ' });
    expect(sortableKeyDown).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  // dnd-kit's KeyboardSensor drops a folder picked up by keyboard on Enter from its own document
  // listener; focus is still on the card, so the card must not also open the folder for that Enter.
  it('does not open the folder when Enter drops it after a keyboard drag', () => {
    sortable.isDragging = true;
    const { card, onNavigate } = renderCard();

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
