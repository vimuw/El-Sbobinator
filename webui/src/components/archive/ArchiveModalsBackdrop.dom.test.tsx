import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { BACKDROP_SHAKE_MS } from '../../hooks/useBackdropDismiss';
import { ShareExportModal } from '../modals/ShareExportModal';
import { UNSAVED_CHANGES_HINT } from '../modals/UnsavedChangesHint';
import { AddSessionsToFolderModal, FolderModal } from './FolderModals';
import { MoveToFolderModal } from './MoveToFolderModal';
import { RenameSessionModal } from './RenameSessionModal';

// A click on the dimmed page around the archive's modals: with nothing to lose it closes them,
// with unsaved edits the card shakes and the action that keeps them lights up instead.

const folder: ArchiveFolder = { id: 'course', name: 'Anatomia', color: '#4D96FF', session_dirs: [] };
const session: ArchiveSession = {
  session_dir: 'session-1',
  name: 'Lezione 1',
  html_path: '/path/1.html',
  input_path: '/path/1.mp3',
  completed_at_iso: '2026-01-01T10:00:00Z',
  effective_model: 'gemini-2.5-flash',
};

function expectShake(container: HTMLElement, primaryName: string | RegExp) {
  expect(container.querySelector('.modal-card')?.classList.contains('is-shaking')).toBe(true);
  expect(screen.getByRole('status').textContent).toBe(UNSAVED_CHANGES_HINT);
  expect(screen.getByRole('button', { name: primaryName }).classList.contains('is-attention')).toBe(true);
  act(() => { vi.advanceTimersByTime(BACKDROP_SHAKE_MS); });
  expect(container.querySelector('.modal-card')?.classList.contains('is-shaking')).toBe(false);
}

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { pywebview?: unknown }).pywebview;
});

describe('FolderModal', () => {
  it('closes on a click outside while the name and colour are untouched', () => {
    const onClose = vi.fn();
    render(<FolderModal state={{ type: 'edit', folder }} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId('folder-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a new name', () => fireEvent.change(screen.getByLabelText('Nome raccolta'), { target: { value: 'Fisiologia' } })],
    ['a new colour', () => fireEvent.click(screen.getByRole('button', { name: 'Automatico' }))],
  ])('shakes instead of closing with %s', (_, edit) => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<FolderModal state={{ type: 'edit', folder }} onClose={onClose} onSave={vi.fn()} />);
    edit();
    fireEvent.click(screen.getByTestId('folder-modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expectShake(container, 'Salva modifiche');
  });

  it('does not close when a click inside the card lands on it', () => {
    const onClose = vi.fn();
    const { container } = render(<FolderModal state={{ type: 'create' }} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.click(container.querySelector('.modal-body')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('RenameSessionModal', () => {
  it('closes on a click outside while the name is the one it opened with', () => {
    const onClose = vi.fn();
    render(<RenameSessionModal session={session} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('rename-session-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shakes instead of closing once the name is changed', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<RenameSessionModal session={session} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Nome sbobina'), { target: { value: 'Lezione 1 — ripasso' } });
    fireEvent.click(screen.getByTestId('rename-session-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expectShake(container, 'Salva');
    expect((screen.getByLabelText('Nome sbobina') as HTMLInputElement).value).toBe('Lezione 1 — ripasso');
    // Undone by hand, nothing is left to save: the line goes and a click outside closes again.
    fireEvent.change(screen.getByLabelText('Nome sbobina'), { target: { value: 'Lezione 1' } });
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.click(screen.getByTestId('rename-session-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a click outside while saving', async () => {
    let resolveSave!: () => void;
    const onClose = vi.fn();
    render(<RenameSessionModal session={session} onSave={() => new Promise<void>(resolve => { resolveSave = resolve; })} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Nome sbobina'), { target: { value: 'Nuovo nome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    fireEvent.click(screen.getByTestId('rename-session-backdrop'));
    expect(screen.queryByText('Salvataggio…')).not.toBeNull();
    expect(document.querySelector('.modal-card.is-shaking')).toBeNull();
    await act(async () => { resolveSave(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AddSessionsToFolderModal', () => {
  it('closes on a click outside after only a search, with nothing selected', () => {
    const onClose = vi.fn();
    render(<AddSessionsToFolderModal folder={folder} availableSessions={[session]} onClose={onClose} onAdd={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Lez' } });
    fireEvent.click(screen.getByTestId('add-sessions-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shakes instead of closing once a sbobina is selected', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<AddSessionsToFolderModal folder={folder} availableSessions={[session]} onClose={onClose} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByText('Lezione 1'));
    fireEvent.click(screen.getByTestId('add-sessions-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expectShake(container, 'Aggiungi (1)');
  });
});

describe('MoveToFolderModal', () => {
  const folders: ArchiveFolder[] = [folder, { id: 'module', name: 'Modulo 1', color: '', parent_id: 'course', session_dirs: [] }];

  it('closes on a click outside while the destination is still the starting one', () => {
    const onClose = vi.fn();
    render(<MoveToFolderModal folders={folders} initialParentId="course" onClose={onClose} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByTestId('move-folder-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another destination', () => fireEvent.click(screen.getByRole('button', { name: 'Modulo 1' }))],
    ['a new raccolta being named', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Nuova raccolta…' }));
      fireEvent.change(screen.getByLabelText('Nome raccolta'), { target: { value: 'Modulo 2' } });
    }],
    ['a raccolta created here', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Nuova raccolta…' }));
      fireEvent.change(screen.getByLabelText('Nome raccolta'), { target: { value: 'Modulo 2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Crea' }));
      fireEvent.click(screen.getByRole('button', { name: 'Anatomia' }));
    }],
  ])('shakes instead of closing with %s', (_, edit) => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<MoveToFolderModal folders={folders} initialParentId="course" onClose={onClose} onConfirm={vi.fn()} />);
    edit();
    fireEvent.click(screen.getByTestId('move-folder-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expectShake(container, 'Sposta qui');
  });
});

describe('ShareExportModal', () => {
  it('closes on a click outside: nothing in it waits to be saved', () => {
    const onClose = vi.fn();
    render(<ShareExportModal session={session} onClose={onClose} />);
    fireEvent.click(screen.getByText('Solo Sbobina (Leggero)'));
    fireEvent.click(screen.getByTestId('share-export-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a click outside while the package is being exported', async () => {
    let resolveExport!: (value: { ok: boolean }) => void;
    (window as unknown as { pywebview: unknown }).pywebview = {
      api: { export_sbobina_package: () => new Promise(resolve => { resolveExport = resolve; }) },
    };
    const onClose = vi.fn();
    render(<ShareExportModal session={session} onClose={onClose} />);
    fireEvent.click(screen.getByText('Esporta Pacchetto (.sbobina)'));
    fireEvent.click(screen.getByTestId('share-export-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { resolveExport({ ok: true }); });
    fireEvent.click(screen.getByTestId('share-export-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
