import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPywebviewApi } from '../../../web/webHost';
import { createWebArchive } from '../../../web/webSessions';
import { WebTrashSection } from './WebTrashSection';

// The "Cestino" of the web settings on the real web host, with the trash on and no Drive.

const input = (name: string) => ({ name, completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'm', input_path: '' });

async function setup() {
  const factory = new IDBFactory();
  const archive = createWebArchive(factory);
  window.pywebview = { api: createWebPywebviewApi(() => {}, { database: factory, drive: null, trash: true }) };
  return { archive };
}

afterEach(() => {
  delete window.pywebview;
});

describe('WebTrashSection', () => {
  it('lists the trashed sbobine with the days left and restores one', async () => {
    const { archive } = await setup();
    const kept = await archive.create(input('Anatomia'), '<p>a</p>');
    const trashed = await archive.create(input('Fisiologia'), '<p>b</p>');
    await archive.trash(trashed.session_dir, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
    const onArchiveChanged = vi.fn();
    render(<WebTrashSection onArchiveChanged={onArchiveChanged} />);

    expect(await screen.findByText('Fisiologia')).toBeTruthy();
    expect(screen.getByText('Ancora 28 giorni')).toBeTruthy();
    expect(screen.queryByText('Anatomia')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina Fisiologia' }));
    expect(await screen.findByText('Il cestino è vuoto.')).toBeTruthy();
    expect(onArchiveChanged).toHaveBeenCalledTimes(1);
    expect((await archive.list()).map(session => session.session_dir).sort()).toEqual([kept.session_dir, trashed.session_dir].sort());
  });

  it('shows a sbobina trashed while it is open, as a sync round does', async () => {
    const { archive } = await setup();
    const session = await archive.create(input('Arrivata da Drive'), '<p>x</p>');
    render(<WebTrashSection />);
    expect(await screen.findByText('Il cestino è vuoto.')).toBeTruthy();
    await archive.trash(session.session_dir, new Date().toISOString());
    expect(await screen.findByText('Arrivata da Drive', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('empties the trash only after the confirmation', async () => {
    const { archive } = await setup();
    const first = await archive.create(input('Uno'), '<p>1</p>');
    const second = await archive.create(input('Due'), '<p>2</p>');
    await archive.trash(first.session_dir, new Date().toISOString());
    await archive.trash(second.session_dir, new Date().toISOString());
    render(<WebTrashSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Svuota cestino' }));
    expect(screen.getByRole('group', { name: 'Svuota cestino' }).textContent).toContain('Le 2 sbobine nel cestino verranno eliminate per sempre');
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(await archive.listTrash()).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Svuota cestino' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina per sempre' }));
    await waitFor(() => expect(screen.getByText('Il cestino è vuoto.')).toBeTruthy());
    expect(await archive.get(first.session_dir)).toBeNull();
  });
});
