import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchiveFolder } from '../../bridge';
import { MoveToFolderModal } from './MoveToFolderModal';

const folders: ArchiveFolder[] = [
  { id: 'course', name: 'Microbiologia', color: '#4D96FF', session_dirs: [] },
  { id: 'module', name: 'Modulo 1', color: '', parent_id: 'course', session_dirs: [] },
];

describe('move destination dialog', () => {
  it('navigates down and up without moving until confirmation', () => {
    const onConfirm = vi.fn();
    render(<MoveToFolderModal folders={folders} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Microbiologia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modulo 1' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Microbiologia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sposta qui' }));
    expect(onConfirm).toHaveBeenCalledWith('course', []);
  });
  it('supports moving to the archive without a collection', () => {
    const onConfirm = vi.fn();
    render(<MoveToFolderModal folders={folders} initialParentId="module" onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archivio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sposta qui' }));
    expect(onConfirm).toHaveBeenCalledWith(null, []);
  });
  it('creates a destination in the chosen parent and submits it together with the move', () => {
    const onConfirm = vi.fn();
    render(<MoveToFolderModal folders={folders} initialParentId="course" onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuova raccolta…' }));
    fireEvent.change(screen.getByLabelText('Nome raccolta'), { target: { value: 'Modulo 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sposta qui' }));
    const [targetId, created] = onConfirm.mock.calls[0];
    expect(created).toEqual([{ id: targetId, name: 'Modulo 2', color: '', parent_id: 'course', session_dirs: [] }]);
  });
  it('discards staged collections when canceled', () => {
    const onConfirm = vi.fn(); const onClose = vi.fn();
    render(<MoveToFolderModal folders={folders} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuova raccolta…' }));
    fireEvent.change(screen.getByLabelText('Nome raccolta'), { target: { value: 'Anno' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
    expect(folders).toHaveLength(2);
  });
  it('excludes the moving folder and its descendants from destinations', () => {
    render(<MoveToFolderModal folders={folders} movingFolderId="course" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Microbiologia' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modulo 1' })).toBeNull();
  });
  it('closes on Escape and traps keyboard focus inside the dialog', () => {
    const onClose = vi.fn();
    render(<MoveToFolderModal folders={folders} onClose={onClose} onConfirm={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Chiudi finestra' });
    const confirm = screen.getByRole('button', { name: 'Sposta qui' });
    confirm.focus(); fireEvent.keyDown(window, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps input focus when archive updates rerender the parent', () => {
    const { rerender } = render(<MoveToFolderModal folders={folders} onClose={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuova raccolta…' }));
    const input = screen.getByLabelText('Nome raccolta');
    input.focus();
    rerender(<MoveToFolderModal folders={[...folders]} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(document.activeElement).toBe(input);
  });
});
