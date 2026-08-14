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
    expect(screen.getAllByTitle('Raccolta: Corso A').length).toBeGreaterThan(0);
  });

  it('renders all sessions in a single list without pagination controls', () => {
    const sessions = Array.from({ length: 15 }, (_, index) => makeSession(`s${index + 1}`, `Lezione ${index + 1}`));
    renderArchive({ sessions });

    // Assert all 15 sessions are visible on the screen
    for (let i = 1; i <= 15; i++) {
      expect(screen.getAllByText(`Lezione ${i}`).length).toBeGreaterThan(0);
    }

    // Assert that the page navigation buttons do not exist
    expect(screen.queryByLabelText('Pagina successiva')).toBeNull();
    expect(screen.queryByLabelText('Pagina precedente')).toBeNull();
  });

  it('displays Aperto badge when last_opened_at_iso is present on a session', () => {
    const session = {
      ...makeSession('s1'),
      last_opened_at_iso: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    renderArchive({ sessions: [session] });
    expect(screen.getAllByText(/Aperto/).length).toBeGreaterThan(0);
  });

  it('expands the unified add lesson panel and renders icon-only add button', () => {
    const s1 = makeSession('s1', 'Lezione In Cartella');
    const s2 = makeSession('s2', 'Lezione Disponibile');
    const folder: ArchiveFolder = {
      id: 'f1',
      name: 'Corso A',
      color: '#4D96FF',
      session_dirs: ['/sessions/s1'],
    };

    renderArchive({ sessions: [s1, s2], folders: [folder] });

    fireEvent.click(screen.getAllByText('Corso A')[0]);

    const toggleButton = screen.getByText('Aggiungi lezione').closest('button');
    expect(toggleButton).toBeTruthy();
    fireEvent.click(toggleButton!);

    const addButton = screen.getByTitle('Aggiungi alla cartella');
    expect(addButton).toBeTruthy();
    expect(addButton.textContent).not.toContain('Aggiungi');
  });

  it('renders the last opened/modified sbobina mini section and triggers preview on click', () => {
    const onPreview = vi.fn();
    const s1 = {
      ...makeSession('s1', 'Lezione Vecchia'),
      completed_at_iso: '2024-01-01T00:00:00Z',
    };
    const s2 = {
      ...makeSession('s2', 'Lezione Recente'),
      last_opened_at_iso: new Date(Date.now() - 60000).toISOString(),
    };

    render(
      <ArchivePage
        sessions={[s1, s2]}
        folders={[]}
        onFoldersChange={vi.fn()}
        onPreview={onPreview}
        onOpenFile={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    expect(screen.getByText('Ultima sbobina aperta / modificata')).toBeTruthy();
    expect(screen.getAllByText('Lezione Recente').length).toBeGreaterThan(0);
    expect(screen.getByText('Riprendi')).toBeTruthy();

    fireEvent.click(screen.getByText('Riprendi'));
    expect(onPreview).toHaveBeenCalledWith(s2.html_path, s2.name, s2.input_path, undefined, s2.session_dir);
  });
});
