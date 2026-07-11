import { render, screen } from '@testing-library/react';
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

  it('renders all sessions in a single list without pagination controls', () => {
    const sessions = Array.from({ length: 15 }, (_, index) => makeSession(`s${index + 1}`, `Lezione ${index + 1}`));
    renderArchive({ sessions });

    // Assert all 15 sessions are visible on the screen
    for (let i = 1; i <= 15; i++) {
      expect(screen.getByText(`Lezione ${i}`)).toBeTruthy();
    }

    // Assert that the page navigation buttons do not exist
    expect(screen.queryByLabelText('Pagina successiva')).toBeNull();
    expect(screen.queryByLabelText('Pagina precedente')).toBeNull();
  });
});
