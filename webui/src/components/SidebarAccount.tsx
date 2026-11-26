import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cloud, CloudCheck, CloudOff, CloudSync, Loader2, LogOut, RefreshCw, X, type LucideIcon } from 'lucide-react';
import { DRIVE_EXPIRED_ERROR } from '../bridge';
import { DRIVE_HEALTH_LABEL, DRIVE_WAITING_FOR_RUN, driveHealth, formatLastSync, useDriveStatus, type DriveHealth } from '../hooks/useDriveStatus';
import { usePhoneLayout } from '../hooks/usePhoneLayout';
import { popoverVariants } from '../motion';
import { CloudTransfer, CloudWarning } from './driveCloudIcons';
import { DRIVE_LINK_REASONS, DRIVE_STAYS_HERE, DriveAvatar } from './modals/settings/WebDriveSection';
import { StatusBadge, type StatusBadgeTone } from './modals/settings/SettingsLayout';
import { PopoverCaret, SidebarTooltip, caretCenterFromBottom } from './sidebarParts';

// Web builds with Drive sync: Google Drive in the sidebar, just above Impostazioni. El Sbobinator
// has no account of its own, so the button is a cloud drawing the sync state (no avatar, no dot):
// crossed out while Drive is not linked, ticked when in sync, an arrow rising into it during a
// round, with a warning while it needs a new login or failed (driveCloudIcons). A tap opens a small panel framed like the
// notifications one: a header with the state, the account and sync (or why to link Drive, with the
// reasons of Impostazioni → Google Drive) and, linked, the way to unlink Drive. It says what the
// settings say, so it has no way there: erasing the copy on Drive, the one thing it leaves out, is
// rare and stays in the settings, apart from the daily actions.

const POLL_MS = 5000;
// How far the menu's bottom drops below the button's, and its left edge, matching the notifications.
const MENU_DROP = 16;
const MENU_LEFT = 72;

const CLOUD_ICON: Record<DriveHealth, LucideIcon> = {
  off: CloudOff,
  ok: CloudCheck,
  syncing: CloudTransfer,
  reconnect: CloudWarning,
  error: CloudWarning,
};

const BADGE_TONE: Record<DriveHealth, StatusBadgeTone> = {
  off: 'neutral',
  syncing: 'accent',
  ok: 'success',
  reconnect: 'warning',
  error: 'error',
};

// Under the "Google Drive" heading the state alone, short ("Google Drive · In corso"), without
// saying "sincronizzazione" again. The button's label and Impostazioni keep the full labels.
// The labels agree with "Google Drive" (masculine): linked and synced reads "Collegato", the
// opposite of "Non collegato" the same badge shows once the account is gone.
const MENU_BADGE_LABEL: Record<DriveHealth, string> = {
  off: 'Non collegato',
  syncing: 'In corso',
  ok: 'Collegato',
  reconnect: 'Da riconnettere',
  error: 'Errore',
};

export function SidebarAccount() {
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
  const cloud: DriveHealth = connected ? health : 'off';
  const CloudIcon = CLOUD_ICON[cloud];
  const label = connected ? `Google Drive: ${DRIVE_HEALTH_LABEL[health]}` : 'Collega Google Drive';

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
  const spinner = <Loader2 className="w-4 h-4 animate-spin" />;

  return (
    <>
      <SidebarTooltip label={label} disabled={open}>
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
          <span className={`sidebar-drive-cloud is-${cloud} inline-flex items-center justify-center`} style={{ lineHeight: 0 }}>
            <CloudIcon size={18} aria-hidden="true" data-testid={`sidebar-drive-${cloud}`} />
          </span>
        </button>
      </SidebarTooltip>

      {open && <div className="fixed inset-0 z-[var(--z-dismiss-layer)]" onClick={() => setOpen(false)} aria-hidden="true" />}
      {/* It closes as the other menus do, short and flat, instead of vanishing. */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="sidebar-account-menu"
            role="dialog"
            aria-label="Account Google Drive"
            initial="closed"
            animate="open"
            exit="closed"
            variants={popoverVariants({ x: isPhone ? 0 : -6, y: isPhone ? 4 : 0, scale: 0.94, blur: 6 })}
            className="sidebar-account-menu fixed z-[var(--z-dialog)] flex flex-col"
            style={isPhone
              ? { left: 8, right: 8, bottom: 64, transformOrigin: 'bottom center' }
              : { left: MENU_LEFT, bottom: anchor?.bottom ?? 16, width: 300, transformOrigin: anchor ? `left calc(100% - ${anchor.caret}px)` : 'left bottom' }}
          >
            {/* Header like the notifications panel, named like its settings page, with
                the state right after the title as in the settings sections. */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border-subtle)]">
              <h3 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">Google Drive</h3>
              <StatusBadge tone={connected ? BADGE_TONE[health] : 'neutral'}>{connected ? MENU_BADGE_LABEL[health] : 'Non collegato'}</StatusBadge>
            </div>

            <div className={isPhone ? 'p-3 space-y-2.5' : 'p-4 space-y-3'}>
              {connected ? (
                <>
                  <div className="flex items-center gap-3">
                    <DriveAvatar email={email} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate" data-testid="sidebar-account-email">{email ?? 'account Google'}</p>
                      {/* While a round runs the badge says so and the button's icon turns: this line
                          keeps the last sync instead of saying it a third time. */}
                      <p className="text-xs text-[var(--text-secondary)]">
                        {health === 'reconnect'
                          ? 'L’accesso è scaduto: le sbobine restano in questo browser finché non ti riconnetti.'
                          : status?.waiting_for_run
                            ? DRIVE_WAITING_FOR_RUN
                            : formatLastSync(status?.last_sync_at ?? null)}
                      </p>
                    </div>
                  </div>
                  {/* To reconnect, the 401's "scaduto" repeats the line above; any other error (a
                      "Riconnetti" that failed) says why the tap did not work. */}
                  {status?.error && !(health === 'reconnect' && status.error === DRIVE_EXPIRED_ERROR) && (
                    <p role="alert" className="text-xs text-[var(--error-text)]">{status.error}</p>
                  )}
                  {/* One row as in the settings: the daily action with its word, then the way out as
                      an icon. "Scollega Drive" asks nothing: the sbobine stay here and the copy on
                      Drive is kept, so linking again brings everything back; erasing Drive stays in
                      the settings. "Scollega", not "Esci": there is no app account. */}
                  <div className="flex items-center gap-2" data-testid="sidebar-account-actions">
                    {health === 'reconnect' ? (
                      <button type="button" onClick={drive.connect} disabled={busy !== null} className="modal-action-button is-primary flex-1 justify-center">
                        {busy === 'connect' ? spinner : <RefreshCw className="w-4 h-4" />}<span>Riconnetti</span>
                      </button>
                    ) : (
                      <button type="button" onClick={drive.syncNow} disabled={busy !== null || Boolean(status?.syncing || status?.waiting_for_run)} className="app-button-secondary is-settings-action flex-1 justify-center">
                        {/* The Drive sync's cloud, as in the settings; a round in progress swaps it for
                            the spinner rather than turning the cloud. */}
                        {busy === 'sync' || status?.syncing ? spinner : <CloudSync className="w-4 h-4" aria-hidden="true" />}<span>Sincronizza</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => drive.leave(false)}
                      disabled={busy !== null}
                      aria-label="Scollega Drive"
                      title="Scollega Drive"
                      data-testid="sidebar-account-leave"
                      className="app-button-secondary is-settings-action is-icon shrink-0"
                    >
                      {busy === 'disconnect' ? spinner : <LogOut className="w-4 h-4" aria-hidden="true" />}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* A phone keeps only the list: the header already says it is not linked. */}
                  {!isPhone && <p className="text-xs text-[var(--text-secondary)]">Le sbobine ora sono solo in questo browser. Collegando il tuo account Google:</p>}
                  <ul className={`${isPhone ? 'space-y-1.5' : 'space-y-2'} text-xs text-[var(--text-primary)]`}>
                    {DRIVE_LINK_REASONS.map(([Icon, text]) => (
                      <li key={text} className="flex items-start gap-2">
                        <Icon className="w-4 h-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                        <span>{text}</span>
                      </li>
                    ))}
                    {/* What stays out, as "Cosa va su Drive" in the settings says: here before linking. */}
                    <li className="flex items-start gap-2 text-[var(--text-secondary)]" data-testid="sidebar-account-stays">
                      <X className="w-4 h-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                      <span>{DRIVE_STAYS_HERE}</span>
                    </li>
                  </ul>
                  {status?.error && <p role="alert" className="text-xs text-[var(--error-text)]">{status.error}</p>}
                  <button type="button" onClick={linkDrive} disabled={busy !== null} className="modal-action-button is-primary w-full justify-center">
                    {busy === 'connect' ? spinner : <Cloud className="w-4 h-4" />}<span>Collega Google Drive</span>
                  </button>
                </>
              )}
            </div>

            {!isPhone && anchor && <PopoverCaret centerFromBottom={anchor.caret} />}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
