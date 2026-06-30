import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchiveFolder, ArchiveSession } from '../bridge';
import { ArchivePage } from './ArchivePage';

function makeSession(id: string, name = `Lezione ${id}`): ArchiveSession {
  return {
    session_dir: `/sessions/${id}`,
    name,
    html_path: `/sessions/${id}/out.html`,
    input_path: `/audio/${id}.mp3`,
    completed_at_iso: `2024-01-0${Math.min(Number(id.replace(/\D/g, '')) || 1, 9)}T00:00:00`,
    effective_model: 'gemini-flash',
  };
}

function renderArchive(overrides: Partial<{
  sessions: ArchiveSession[];
  folders: ArchiveFolder[];
  onFoldersChange: (folders: ArchiveFolder[]) => void;
}> = {}) {
  return render(
    <ArchivePage
      sessions={overrides.sessions ?? [makeSession('s1')]}
      folders={overrides.folders ?? []}
      onFoldersChange={overrides.onFoldersChange ?? vi.fn()}
      onPreview={vi.fn()}
      onOpenFile={vi.fn()}
      onDeleteSession={vi.fn()}
    />,
  );
}

describe('ArchivePage', () => {
  it('shows the folder indicator on archive session cards', () => {
    const folder: ArchiveFolder = {
      id: 'f1',
      name: 'Corso A',
      color: '#4D96FF',
      session_dirs: ['/sessions/s1'],
    };
    renderArchive({ folders: [folder] });
    expect(screen.getByTitle('Raccolta: Corso A')).toBeTruthy();
  });

  it('can move a folder detail item to the next page while preserving the full order', () => {
    const sessions = Array.from({ length: 6 }, (_, index) => makeSession(`s${index + 1}`, `Lezione ${index + 1}`));
    const folder: ArchiveFolder = {
      id: 'f1',
      name: 'Corso A',
      color: '#4D96FF',
      session_dirs: sessions.map(s => s.session_dir),
    };
    const onFoldersChange = vi.fn();
    renderArchive({ sessions, folders: [folder], onFoldersChange });

    fireEvent.click(screen.getAllByText('Corso A')[0]);
    fireEvent.click(screen.getByLabelText('Sposta Lezione 1 alla pagina successiva'));

    expect(onFoldersChange).toHaveBeenCalledWith([
      {
        ...folder,
        session_dirs: [
          '/sessions/s2',
          '/sessions/s3',
          '/sessions/s4',
          '/sessions/s5',
          '/sessions/s6',
          '/sessions/s1',
        ],
      },
    ]);
  });

  it('hides folder page-move controls while searching', () => {
    const sessions = Array.from({ length: 6 }, (_, index) => makeSession(`s${index + 1}`, `Lezione ${index + 1}`));
    const folder: ArchiveFolder = {
      id: 'f1',
      name: 'Corso A',
      color: '#4D96FF',
      session_dirs: sessions.map(s => s.session_dir),
    };
    const onFoldersChange = vi.fn();
    renderArchive({ sessions, folders: [folder], onFoldersChange });

    fireEvent.click(screen.getAllByText('Corso A')[0]);
    fireEvent.change(screen.getByPlaceholderText('Cerca per nome...'), { target: { value: 'Lezione' } });

    expect(screen.queryByLabelText('Sposta Lezione 1 alla pagina successiva')).toBeNull();
    expect(onFoldersChange).not.toHaveBeenCalled();
  });
});
