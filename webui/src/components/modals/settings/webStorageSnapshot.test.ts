import { afterEach, describe, expect, it } from 'vitest';
import { readBackupFigures, readDriveStatus, readTrash, webStorageSnapshot } from './webStorageSnapshot';

// Node environment: no window, as after a page (or a DOM test) is torn down while a read is pending.
const globals = globalThis as { window?: unknown };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  delete globals.window;
});

describe('web storage snapshot reads', () => {
  it('keep each answer for the host that was asked, even once the window is gone', async () => {
    const backup = deferred<unknown>();
    const trash = deferred<unknown>();
    const drive = deferred<unknown>();
    const api = {
      get_web_backup_info: () => backup.promise,
      list_trash: () => trash.promise,
      get_drive_status: () => drive.promise,
    };
    globals.window = { pywebview: { api } };

    const reads = Promise.all([readBackupFigures(), readTrash(), readDriveStatus()]);
    delete globals.window;
    backup.resolve({ ok: true, sessions: 2, text_bytes: 10, audio_bytes: 20, audio_files: 1, last_backup_at: null });
    trash.resolve({ ok: true, sessions: [] });
    drive.resolve({ enabled: true });

    await expect(reads).resolves.toEqual([
      { sessions: 2, textBytes: 10, audioBytes: 20, audioFiles: 1, lastBackupAt: null },
      { sessions: [] },
      { enabled: true },
    ]);

    globals.window = { pywebview: { api } };
    expect(webStorageSnapshot()).toEqual({
      backup: { sessions: 2, textBytes: 10, audioBytes: 20, audioFiles: 1, lastBackupAt: null },
      trash: [],
      drive: { enabled: true },
    });
  });
});
