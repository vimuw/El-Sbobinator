import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, Cloud, EyeOff, Loader2, LogOut, MonitorSmartphone, RefreshCw, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { DRIVE_HEALTH_LABEL, driveHealth, formatLastSync, useDriveStatus, type DriveHealth } from '../hooks/useDriveStatus';
import { usePhoneLayout } from '../hooks/usePhoneLayout';
import { popoverVariants } from '../motion';
import { DriveAvatar } from './modals/settings/WebDriveSection';
import { StatusBadge, type StatusBadgeTone } from './modals/settings/SettingsLayout';
import { PopoverCaret, SidebarBadge, SidebarTooltip, caretCenterFromBottom, type SidebarBadgeTone } from './sidebarParts';

// Web builds with Drive sync: the Google account at the foot of the sidebar, below Impostazioni and
// apart from the tools. Linked, it is the account's initial with the sync state as a dot; not
// linked, the same circle left empty with a quiet grey dot, inviting to link Drive. A tap opens a small panel framed like the notifications one: a header with the state,
// the account and sync (or why to link it), and the way to the settings and, linked, out of the account.

const POLL_MS = 5000;
// How far the menu's bottom drops below the button's, and its left edge, matching the notifications.
const MENU_DROP = 16;
const MENU_LEFT = 72;

const DOT_TONE: Record<DriveHealth, SidebarBadgeTone> = {
  off: 'neutral',
  ok: 'success',
  syncing: 'processing',
  reconnect: 'warning',
  error: 'alert',
};

const BADGE_TONE: Record<DriveHealth, StatusBadgeTone> = {
  off: 'neutral',
  syncing: 'accent',
  ok: 'success',
  reconnect: 'warning',
  error: 'error',
};

interface SidebarAccountProps {
  /** "Gestisci in Impostazioni": Impostazioni → Sincronizzazione. */
  onOpenStorageSettings: () => void;
}

export function SidebarAccount({ onOpenStorageSettings }: SidebarAccountProps) {
  const drive = useDriveStatus(POLL_MS);
  const isPhone = usePhoneLayout();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ bottom: number; caret: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!drive.available) return null;

  const { status, busy } = drive;
  const connected = Boolean(status?.connected);
  const health = driveHealth(status, busy);
  const email = connected ? status?.email ?? null : null;
  const label = connected ? `Account Google: ${email ?? 'collegato'} (${DRIVE_HEALTH_LABEL[health]})` : 'Collega Google Drive';
  const dot = connected ? DOT_TONE[health] : 'neutral';

  const toggle = () => {
    // Beside the sidebar like the notifications panel, a little below the button so the caret
    // pointing at it clears the rounded corner; on a phone above the bottom bar, full width.
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const bottom = Math.max(8, window.innerHeight - rect.bottom - MENU_DROP);
      setAnchor({ bottom, caret: caretCenterFromBottom(buttonRef.current, bottom, MENU_DROP + rect.height / 2) });
    }
    setOpen(value => !value);
  };
  const linkDrive = () => {
    drive.choose('drive');
    drive.connect();
  };
  const openSettings = () => {
    setOpen(false);
    onOpenStorageSettings();
  };
  const spinner = <Loader2 className="w-4 h-4 animate-spin" />;
  const settingsLabel = connected ? 'Gestisci in Impostazioni' : 'Più dettagli in Impostazioni';
  // On a phone the way to the settings sits beside the main button, not in a footer of its own.
  const withSettings = (action: ReactNode) => isPhone ? (
    <div className="flex items-stretch gap-2">
      <div className="flex-1 min-w-0 flex">{action}</div>
      <button type="button" onClick={openSettings} aria-label={settingsLabel} title={settingsLabel} className="app-button-secondary is-settings-action shrink-0 justify-center" data-testid="sidebar-account-settings">
        <Settings className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  ) : action;

  return (
    <>
      <span className="sidebar-account-divider" aria-hidden="true" />
      <SidebarTooltip label={connected ? `Collegato come ${email ?? 'account Google'}` : 'Collega Google Drive'} disabled={open}>
        <button
          ref={buttonRef}
          type="button"
          onClick={toggle}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="sidebar-account"
          className="sidebar-nav-item w-9 h-9 flex items-center justify-center rounded-lg group/util"
          style={{
            background: open ? 'var(--sidebar-active-bg)' : 'transparent',
            color: 'var(--text-secondary)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <span className="sidebar-account-avatar inline-flex items-center justify-center transition-transform duration-200 group-hover/util:scale-105" style={{ position: 'relative', lineHeight: 0, color: 'var(--text-muted)' }}>
            {connected ? (
              <DriveAvatar email={email} size={22} />
            ) : (
              <EmptyAvatar />
            )}
            <SidebarBadge tone={dot} />
          </span>
        </button>
      </SidebarTooltip>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-label="Account Google Drive"
            initial="closed"
            animate="open"
            variants={popoverVariants({ x: isPhone ? 0 : -6, y: isPhone ? 4 : 0, scale: 0.94, blur: 6 })}
            className="sidebar-account-menu fixed z-50 flex flex-col"
            style={isPhone
              ? { left: 8, right: 8, bottom: 64, transformOrigin: 'bottom center' }
              : { left: MENU_LEFT, bottom: anchor?.bottom ?? 16, width: 300, transformOrigin: anchor ? `left calc(100% - ${anchor.caret}px)` : 'left bottom' }}
          >
            {/* Header like the notifications panel, named like the settings page it leads to, with
                the state right after the title as in the settings sections. */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border-subtle)]">
              <h3 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">Sincronizzazione</h3>
              <StatusBadge tone={connected ? BADGE_TONE[health] : 'neutral'}>{connected ? DRIVE_HEALTH_LABEL[health] : 'Non collegato'}</StatusBadge>
            </div>

            <div className={isPhone ? 'p-3 space-y-2.5' : 'p-4 space-y-3'}>
              {connected ? (
                <>
                  <div className="flex items-center gap-3">
                    <DriveAvatar email={email} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate" data-testid="sidebar-account-email">{email ?? 'account Google'}</p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {health === 'reconnect'
                          ? 'L’accesso è scaduto: le sbobine restano in questo browser finché non ti riconnetti.'
                          : health === 'syncing'
                            ? 'Sincronizzazione in corso…'
                            : formatLastSync(status?.last_sync_at ?? null)}
                      </p>
                    </div>
                  </div>
                  {status?.error && health !== 'reconnect' && (
                    <p role="alert" className="text-xs text-[var(--error-text)]">{status.error}</p>
                  )}
                  {withSettings(health === 'reconnect' ? (
                    <button type="button" onClick={drive.connect} disabled={busy !== null} className="modal-action-button is-primary w-full justify-center">
                      {busy === 'connect' ? spinner : <RefreshCw className="w-4 h-4" />}<span>Riconnetti</span>
                    </button>
                  ) : (
                    <button type="button" onClick={drive.syncNow} disabled={busy !== null || Boolean(status?.syncing)} className="app-button-secondary is-settings-action w-full justify-center">
                      {busy === 'sync' ? spinner : <RefreshCw className="w-4 h-4" />}<span>Sincronizza ora</span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {/* A phone keeps only the three reasons: the header already says it is not linked. */}
                  {!isPhone && <p className="text-xs text-[var(--text-secondary)]">Le sbobine ora sono solo in questo browser. Collegando il tuo account Google:</p>}
                  <ul className={`${isPhone ? 'space-y-1.5' : 'space-y-2'} text-xs text-[var(--text-primary)]`}>
                    <li className="flex items-start gap-2">
                      <MonitorSmartphone className="w-4 h-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                      <span>le ritrovi sugli altri dispositivi</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                      <span>se il browser le cancella, restano su Drive</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <EyeOff className="w-4 h-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                      <span>in una cartella nascosta che vede solo l’app</span>
                    </li>
                  </ul>
                  {status?.error && <p role="alert" className="text-xs text-[var(--error-text)]">{status.error}</p>}
                  {withSettings(
                    <button type="button" onClick={linkDrive} disabled={busy !== null} className="modal-action-button is-primary w-full justify-center">
                      {busy === 'connect' ? spinner : <Cloud className="w-4 h-4" />}<span>Collega Google Drive</span>
                    </button>,
                  )}
                </>
              )}
            </div>

            {(!isPhone || connected) && (
              <div className="border-t border-[var(--border-subtle)] p-2 space-y-0.5">
                {!isPhone && (
                  <button type="button" onClick={openSettings} className="sidebar-account-link">
                    <Settings className="w-4 h-4" aria-hidden="true" />
                    <span className="flex-1 text-left">{settingsLabel}</span>
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                {/* As "Disconnetti" in the settings: the sbobine stay here and the copy on Drive is
                    kept, so linking again brings everything back; no confirmation needed. Erasing
                    Drive stays in the settings. */}
                {connected && (
                  <button type="button" onClick={() => drive.leave(false)} disabled={busy !== null} className="sidebar-account-link" data-testid="sidebar-account-leave">
                    {busy === 'disconnect' ? spinner : <LogOut className="w-4 h-4" aria-hidden="true" />}
                    <span className="flex-1 text-left">Esci dall’account</span>
                  </button>
                )}
              </div>
            )}
            {!isPhone && anchor && <PopoverCaret centerFromBottom={anchor.caret} />}
          </motion.div>
        </>
      )}
    </>
  );
}

// The avatar's circle left empty: a soft solid disc the size of the linked initial, with lucide's
// UserRound inside (a dashed ring frayed at 22px). Filled on hover, like the tools above it.
function EmptyAvatar() {
  return (
    <span className="sidebar-account-empty" aria-hidden="true" data-testid="sidebar-account-empty">
      <UserRound className="w-3.5 h-3.5" strokeWidth={2.25} />
    </span>
  );
}
