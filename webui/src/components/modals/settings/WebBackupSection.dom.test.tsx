import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../storageKeys';
import { createWebPywebviewApi } from '../../../web/webHost';
import { createWebMediaStore } from '../../../web/webMedia';
import { createWebArchive } from '../../../web/webSessions';
import { WebBackupSection } from './WebBackupSection';

// The backup panel of the web settings, on the real web host over fake-indexeddb.

let factory: IDBFactory;
let created: Blob[];

beforeEach(() => {
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  localStorage.clear();
  factory = new IDBFactory();
  vi.stubGlobal('indexedDB', factory);
  created = [];
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return `blob:backup-${created.length}`;
    },
    revokeObjectURL: vi.fn(),
  }));
  window.pywebview = { api: createWebPywebviewApi(() => {}, { database: factory }) };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.pywebview;
});

async function seed() {
  const archive = createWebArchive(factory);
  const session = await archive.create({ name: 'Fisiologia', completed_at_iso: '2026-10-20T10:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' }, '<p>Il nefrone</p>');
  const media = createWebMediaStore(factory);
  await media.save('a1', new File([new Uint8Array(2 * 1024 * 1024)], 'Fisiologia.m4a', { type: 'audio/mp4' }));
  await media.link('a1', session.session_dir);
  return session;
}

describe('WebBackupSection', () => {
  it('shows the estimated size with and without audio, and the last backup', async () => {
    await seed();
    render(<WebBackupSection />);

    await waitFor(() => expect(screen.getByTestId('web-backup-estimate').textContent).toMatch(/^1 sbobina · dimensione stimata 2,0 MB$/));
    expect(screen.getByText('1 file, 2,0 MB')).toBeTruthy();
    // What the backup leaves out sits beside its estimate, not under the browser total.
    expect(screen.getByTestId('web-backup-scope').textContent).toContain('avanzamento delle elaborazioni');
    expect(screen.getByTestId('web-backup-last').textContent).toBe('Nessun backup scaricato da questo browser.');

    fireEvent.click(screen.getByRole('switch', { name: 'Includi gli audio delle lezioni nel backup' }));
    expect(screen.getByTestId('web-backup-estimate').textContent).toMatch(/dimensione stimata \d+ KB$/);
  });

  it('says there is no audio to include instead of "0 file, 0 KB", and locks the switch', async () => {
    await createWebArchive(factory).create({ name: 'Solo testo', completed_at_iso: '2026-10-20T10:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' }, '<p>Testo</p>');
    render(<WebBackupSection />);

    expect(await screen.findByText('Nessun audio salvato in questo browser')).toBeTruthy();
    expect(screen.queryByText(/^0 file/)).toBeNull();
    expect((screen.getByRole('switch', { name: 'Includi gli audio delle lezioni nel backup' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('prepares the zip, then saves it from a real download link and records the date', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1, 'AIzaSyNeverInTheBackup123456789');
    await seed();
    render(<WebBackupSection />);
    const prepare = await screen.findByRole('button', { name: 'Prepara backup' });
    await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(prepare);
    const link = await screen.findByTestId('web-backup-download');
    expect(link.getAttribute('href')).toBe('blob:backup-1');
    expect(link.getAttribute('download')).toMatch(/^El-Sbobinator-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(link.textContent).toMatch(/Salva il backup \(2,0 MB\)/);
    expect(await created[0].text()).not.toContain('AIzaSyNeverInTheBackup');

    link.addEventListener('click', event => event.preventDefault());
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('web-backup-last').textContent).toMatch(/^Ultimo backup scaricato: \d+ \w+ \d{4}\.$/));
    expect(localStorage.getItem(STORAGE_KEYS.WEB_LAST_BACKUP_V1)).toMatch(/^\d{4}-/);
  });

  it('imports a backup into an empty browser and reports what changed', async () => {
    await seed();
    const backup = await window.pywebview!.api.create_web_backup!(true);
    // A new device: empty database, same backup file.
    factory = new IDBFactory();
    window.pywebview = { api: createWebPywebviewApi(() => {}, { database: factory }) };
    const onImported = vi.fn();
    render(<WebBackupSection onArchiveImported={onImported} />);
    await waitFor(() => expect(screen.getByTestId('web-backup-estimate').textContent).toMatch(/^0 sbobine/));

    const input = screen.getByLabelText('Scegli il file di backup da importare') as HTMLInputElement;
    expect(input.accept).toBe('.zip,application/zip');
    Object.defineProperty(input, 'files', { value: [new File([backup.blob!], backup.filename!)], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Backup importato: 1 sbobina aggiunta, 1 audio importato.'));
    expect(onImported).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('web-backup-estimate').textContent).toMatch(/^1 sbobina/));
    expect((await createWebArchive(factory).list()).map(session => session.name)).toEqual(['Fisiologia']);
  });

  it('explains a file that is not a backup', async () => {
    render(<WebBackupSection />);
    const input = screen.getByLabelText('Scegli il file di backup da importare') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['ciao'], 'foto.zip')], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/^Il file scelto non è un backup di El Sbobinator\./));
  });
});
