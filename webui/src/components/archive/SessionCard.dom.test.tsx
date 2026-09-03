import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { DraggableSessionCard, SortableSessionCard } from './SessionCard';

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

const mockSession: ArchiveSession = {
  session_dir: '/sessions/s1',
  name: 'Istologia lezione 9 parte 3.m4a',
  html_path: '/sessions/s1/out.html',
  input_path: '/audio/s1.m4a',
  completed_at_iso: '2026-09-03T10:00:00Z',
  effective_model: 'gemini-2.5-flash',
};

const mockWarningSession: ArchiveSession = {
  ...mockSession,
  completion_status: 'completed_with_warnings',
  revision_failed_blocks: [0],
};

const mockFolders: ArchiveFolder[] = [
  {
    id: 'f1',
    name: 'Istologia',
    color: '#3d6b3a',
    session_dirs: ['/sessions/s1'],
  },
];

describe('SessionCard components selection styling', () => {
  describe('DraggableSessionCard', () => {
    it('applies is-selected class when selected=true and toggles selection', () => {
      const onToggleSelect = vi.fn();
      const { container } = render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          selected={true}
          onToggleSelect={onToggleSelect}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(true);

      const selectBtn = screen.getByTitle('Deseleziona');
      fireEvent.click(selectBtn);
      expect(onToggleSelect).toHaveBeenCalledTimes(1);
    });

    it('does not have is-selected class when selected=false', () => {
      const { container } = render(
        <DraggableSessionCard
          session={mockSession}
          allFolders={mockFolders}
          selected={false}
          onToggleSelect={vi.fn()}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(false);
    });

    it('applies warning styling when not selected and yields to is-selected when selected', () => {
      const { container: c1 } = render(
        <DraggableSessionCard
          session={mockWarningSession}
          allFolders={mockFolders}
          selected={false}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card1 = c1.querySelector('.archive-session-card') as HTMLElement;
      expect(card1.style.borderColor).toBe('var(--warning-ring)');
      expect(card1.style.background).toBe('var(--warning-subtle)');
      expect(card1.classList.contains('is-selected')).toBe(false);

      const { container: c2 } = render(
        <DraggableSessionCard
          session={mockWarningSession}
          allFolders={mockFolders}
          selected={true}
          onAssignToFolder={vi.fn()}
          onRemoveFromFolder={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card2 = c2.querySelector('.archive-session-card') as HTMLElement;
      expect(card2.classList.contains('is-selected')).toBe(true);
      expect(card2.style.borderColor).toBe('');
      expect(card2.style.background).toBe('');
    });
  });

  describe('SortableSessionCard', () => {
    it('applies is-selected class when selected=true and toggles selection', () => {
      const onToggleSelect = vi.fn();
      const { container } = render(
        <SortableSessionCard
          session={mockSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={true}
          onToggleSelect={onToggleSelect}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(true);

      const selectBtn = screen.getByTitle('Deseleziona');
      fireEvent.click(selectBtn);
      expect(onToggleSelect).toHaveBeenCalledTimes(1);
    });

    it('does not have is-selected class when selected=false', () => {
      const { container } = render(
        <SortableSessionCard
          session={mockSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={false}
          onToggleSelect={vi.fn()}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );

      const card = container.querySelector('.archive-session-card');
      expect(card).toBeTruthy();
      expect(card?.classList.contains('is-selected')).toBe(false);
    });

    it('applies warning styling when not selected and yields to is-selected when selected', () => {
      const { container: c1 } = render(
        <SortableSessionCard
          session={mockWarningSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={false}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card1 = c1.querySelector('.archive-session-card') as HTMLElement;
      expect(card1.style.borderColor).toBe('var(--warning-ring)');
      expect(card1.style.background).toBe('var(--warning-subtle)');
      expect(card1.classList.contains('is-selected')).toBe(false);

      const { container: c2 } = render(
        <SortableSessionCard
          session={mockWarningSession}
          folderColor="#3d6b3a"
          disabled={false}
          selected={true}
          onRemove={vi.fn()}
          onPreview={vi.fn()}
          onOpenFile={vi.fn()}
          onDeleteSession={vi.fn()}
        />,
      );
      const card2 = c2.querySelector('.archive-session-card') as HTMLElement;
      expect(card2.classList.contains('is-selected')).toBe(true);
      expect(card2.style.borderColor).toBe('');
      expect(card2.style.background).toBe('');
    });
  });
});
