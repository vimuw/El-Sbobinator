import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { ArchiveSession } from '../../../bridge';
import { InlineConfirm, SettingsPanel, StatusBadge } from './SettingsLayout';
import { readTrash, webStorageSnapshot } from './webStorageSnapshot';

// Web previews with the trash: deleted sbobine wait here 30 days, then go for good (on Drive too).

const TRASH_DAYS = 30;
// A sync round may move sbobine in or out of the trash while the settings are open.
const REFRESH_MS = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(trashedAt: string | undefined, now: number): number {
  const at = Date.parse(trashedAt ?? '');
  if (!Number.isFinite(at)) return TRASH_DAYS;
  return Math.max(0, Math.ceil((at + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

interface WebTrashSectionProps {
  /** A restore or the emptied trash changed the archive. */
  onArchiveChanged?: () => void;
  /** The first reading of the trash answered, with the list or an error. */
  onLoaded?: () => void;
}

export const WebTrashSection: React.FC<WebTrashSectionProps> = ({ onArchiveChanged, onLoaded }) => {
  // The last list read (also by the prefetch when the settings opened) shows until a fresh one lands.
  const [sessions, setSessions] = useState<ArchiveSession[] | null>(() => webStorageSnapshot().trash ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the list was read: the days left count from there.
  const [now, setNow] = useState(() => Date.now());
  const api = window.pywebview?.api;

  const mountedRef = useRef(true);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    const result = await readTrash();
    if (!mountedRef.current) return;
    setNow(Date.now());
    if ('sessions' in result) setSessions(result.sessions);
    else setError(result.error);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (webStorageSnapshot().trash) onLoadedRef.current?.();
    void load().finally(() => {
      if (mountedRef.current) onLoadedRef.current?.();
    });
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const restore = async (session: ArchiveSession) => {
    setBusy(session.session_dir);
    const result = await api?.restore_session?.(session.session_dir).catch(() => null);
    setBusy(null);
    if (!result?.ok) setError(result?.error ?? 'Ripristino non riuscito.');
    else onArchiveChanged?.();
    await load();
  };

  const emptyTrash = async () => {
    setBusy('empty');
    const result = await api?.empty_trash?.().catch(() => null);
    setBusy(null);
    setConfirmEmpty(false);
    if (!result?.ok) setError(result?.error ?? 'Cestino non svuotato.');
    // The space the trashed sbobine took is freed: the figures above follow.
    else onArchiveChanged?.();
    await load();
  };

  return (
    <SettingsPanel
      icon={Trash2}
      testId="web-trash"
      title="Cestino"
      description={`Le sbobine eliminate restano qui ${TRASH_DAYS} giorni e puoi ripristinarle. Poi spariscono per sempre, anche da Google Drive.`}
      badge={sessions && sessions.length > 0 ? <StatusBadge tone="neutral">{sessions.length === 1 ? '1 sbobina' : `${sessions.length} sbobine`}</StatusBadge> : undefined}
      // Beside the description, like "Elimina i dati da Drive": the confirmation opens below it.
      action={sessions && sessions.length > 0 && !confirmEmpty && (
        <button
          type="button"
          onClick={() => setConfirmEmpty(true)}
          disabled={busy !== null}
          aria-label="Svuota cestino"
          title="Svuota cestino"
          className="app-button-secondary is-settings-action is-icon is-danger shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    >
      {error && <p role="alert" className="text-xs text-[var(--error-text)]">{error}</p>}
      {sessions === null ? (
        <p className="text-xs text-[var(--text-secondary)]">…</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">Il cestino è vuoto.</p>
      ) : (
        <>
          {confirmEmpty && (
            <InlineConfirm
              tone="danger"
              label="Svuota cestino"
              title="Svuotare il cestino?"
              actions={(
                <>
                  <button type="button" onClick={() => setConfirmEmpty(false)} disabled={busy !== null} className="app-button-secondary is-settings-action">Annulla</button>
                  <button type="button" onClick={() => void emptyTrash()} disabled={busy !== null} className="app-button-secondary is-settings-action is-danger">
                    {busy === 'empty' && <Loader2 className="w-4 h-4 animate-spin" />}<span>Elimina</span>
                  </button>
                </>
              )}
            >
              {/* Only what the section text above doesn't already say: it happens now, and for good. */}
              <p>
                {sessions.length === 1
                  ? 'La sbobina nel cestino verrà eliminata subito, insieme al suo audio. Non potrai più recuperarla.'
                  : `Le ${sessions.length} sbobine nel cestino verranno eliminate subito, insieme al loro audio. Non potrai più recuperarle.`}
              </p>
            </InlineConfirm>
          )}
          <ul className="space-y-0.5">
            {sessions.map(session => {
              const left = daysLeft(session.trashed_at, now);
              return (
                <li key={session.session_dir} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors -mx-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-[var(--text-primary)] truncate">{session.name}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{left === 1 ? 'Ancora 1 giorno' : `Ancora ${left} giorni`}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void restore(session)}
                    disabled={busy !== null}
                    aria-label={`Ripristina ${session.name}`}
                    className="app-button-secondary is-settings-action"
                  >
                    {busy === session.session_dir ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    <span>Ripristina</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SettingsPanel>
  );
};
