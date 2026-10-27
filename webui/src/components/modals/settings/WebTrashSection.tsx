import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { ArchiveSession } from '../../../bridge';
import { SettingsSectionHeading } from './SettingsLayout';

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
}

export const WebTrashSection: React.FC<WebTrashSectionProps> = ({ onArchiveChanged }) => {
  const [sessions, setSessions] = useState<ArchiveSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the list was read: the days left count from there.
  const [now, setNow] = useState(0);
  const api = window.pywebview?.api;

  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const result = await window.pywebview?.api?.list_trash?.().catch(() => null);
    if (!mountedRef.current) return;
    setNow(Date.now());
    if (result?.ok) setSessions(result.sessions ?? []);
    else setError(result?.error ?? 'Cestino non leggibile.');
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
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
    await load();
  };

  return (
    <div className="space-y-3" data-testid="web-trash">
      <div className="space-y-0.5">
        <SettingsSectionHeading>Cestino</SettingsSectionHeading>
        <p className="text-xs text-[var(--text-secondary)]">
          Le sbobine eliminate restano qui {TRASH_DAYS} giorni, poi spariscono per sempre, anche da Google Drive.
        </p>
      </div>
      {error && <p role="alert" className="text-xs text-[var(--error-text)]">{error}</p>}
      {sessions === null ? (
        <p className="text-xs text-[var(--text-secondary)]">…</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">Il cestino è vuoto.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {sessions.map(session => {
              const left = daysLeft(session.trashed_at, now);
              return (
                <li key={session.session_dir} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--text-primary)] truncate">{session.name}</span>
                    <span className="block text-xs text-[var(--text-muted)]">{left === 1 ? 'Ancora 1 giorno' : `Ancora ${left} giorni`}</span>
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
          {!confirmEmpty ? (
            <button type="button" onClick={() => setConfirmEmpty(true)} disabled={busy !== null} className="app-button-secondary is-settings-action text-[var(--error-text)]">
              <Trash2 className="w-4 h-4" />
              <span>Svuota cestino</span>
            </button>
          ) : (
            <div role="group" aria-label="Svuota cestino" className="p-3 rounded-xl border border-[var(--border-subtle)] space-y-2">
              <p className="text-xs text-[var(--text-primary)]">
                {sessions.length === 1 ? 'La sbobina nel cestino verrà eliminata' : `Le ${sessions.length} sbobine nel cestino verranno eliminate`} per sempre, con il loro audio. L’operazione è irreversibile.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void emptyTrash()} disabled={busy !== null} className="app-button-secondary is-settings-action text-[var(--error-text)]">
                  {busy === 'empty' && <Loader2 className="w-4 h-4 animate-spin" />}<span>Elimina per sempre</span>
                </button>
                <button type="button" onClick={() => setConfirmEmpty(false)} disabled={busy !== null} className="app-button-secondary is-settings-action">Annulla</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
