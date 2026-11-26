import { memo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Archive, Bell, Layers, MessageSquareWarning, Settings } from 'lucide-react';
import type { AppStatus } from '../appState';
import { BrandLogo } from './BrandLogo';
import { useReportProblem } from './useReportProblem';
import { SidebarAccount } from './SidebarAccount';
import { ThemeToggleIcon } from './ThemeToggleIcon';
import { SidebarBadge, SidebarTooltip, type SidebarBadgeTone } from './sidebarParts';
export type ActivePage = 'queue' | 'archive';

const SIDEBAR_COLLAPSED_W = 54;

interface NavSidebarProps {
  activePage: ActivePage;
  setActivePage: (page: ActivePage) => void;
  apiReady: boolean;
  bridgeDelayed: boolean;
  hasApiKey: boolean;
  isApiKeyValid: boolean;
  appState: AppStatus;
  themeMode: 'light' | 'dark';
  setThemeMode: Dispatch<SetStateAction<'light' | 'dark'>>;
  setIsSettingsOpen: (v: boolean) => void;
  unreadNotificationsCount: number;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: Dispatch<SetStateAction<boolean>>;
  shakeBell: boolean;
  completionFlash?: boolean;
}

const bellVariants = {
  shake: {
    rotate: [0, -15, 15, -15, 15, -10, 10, -5, 5, 0],
    transition: { duration: 0.5, ease: 'easeInOut' as const }
  },
  idle: { rotate: 0 }
};

export const NavSidebar = memo(function NavSidebar({
  activePage, setActivePage,
  apiReady, bridgeDelayed, hasApiKey, isApiKeyValid, appState,
  themeMode, setThemeMode,
  setIsSettingsOpen,
  unreadNotificationsCount,
  isNotificationsOpen,
  setIsNotificationsOpen,
  shakeBell,
  completionFlash = false,
}: NavSidebarProps) {
  const report = useReportProblem();

  // The Gemini key shows only when something is wrong with it, as a badge on the gear that leads to
  // it: a dot that said "ready" at all times read as a second sync state beside Drive's. The short
  // wait for the host at startup is not a problem worth a badge.
  const apiProblem: { tone: SidebarBadgeTone; label: string } | null = !apiReady
    ? (bridgeDelayed ? { tone: 'alert', label: 'connessione in ritardo' } : null)
    : !hasApiKey ? { tone: 'warning', label: 'manca la chiave API' }
    : !isApiKeyValid ? { tone: 'warning', label: 'chiave API non valida' }
    : null;

  return (
    <nav
      className="app-sidebar flex flex-col"
      style={{
        width: SIDEBAR_COLLAPSED_W,
        height: 'var(--app-height)',
        position: 'sticky',
        top: 0,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-subtle)',
        flexShrink: 0,
        zIndex: 'var(--z-sidebar)',
        overflow: 'visible',
      }}
    >
      {/* Logo */}
      <div className="flex justify-center pt-3 pb-1">
        <BrandLogo
          size={36}
          ariaLabel="Vai alla Dashboard"
          onClick={() => setActivePage('queue')}
          celebrate={completionFlash}
        />
      </div>

      {/* Navigation items */}
      <div className="flex flex-col items-center gap-1.5 px-1.5 pt-2 pb-2 flex-1">
        <NavItem
          icon={<Layers size={20} />}
          label="Dashboard"
          active={activePage === 'queue'}
          onClick={() => setActivePage('queue')}
          isProcessing={appState === 'processing'}
        />
        <NavItem
          icon={<Archive size={20} />}
          label="Archivio"
          active={activePage === 'archive'}
          onClick={() => setActivePage('archive')}
        />
      </div>

      {/* Utility buttons */}
      <div className="px-1.5 pb-3.5 flex flex-col items-center gap-1.5" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <UtilityButton
          icon={<ThemeToggleIcon themeMode={themeMode} size={18} />}
          label={themeMode === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
          active={false}
          onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
          className="theme-toggle-btn"
        />
        <UtilityButton
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <motion.span
                variants={bellVariants}
                animate={shakeBell ? 'shake' : 'idle'}
                style={{ display: 'inline-flex' }}
              >
                <Bell size={18} />
              </motion.span>
              {unreadNotificationsCount > 0 && <SidebarBadge tone="alert" />}
            </span>
          }
          label={unreadNotificationsCount > 0 ? `Notifiche (${unreadNotificationsCount})` : 'Notifiche'}
          ariaLabel="Apri notifiche"
          anchorId="notifications"
          active={isNotificationsOpen}
          onClick={() => setIsNotificationsOpen(prev => !prev)}
        />
        {/* On every page, the editor too, and in the phone's bottom bar. */}
        <UtilityButton
          icon={<MessageSquareWarning size={18} />}
          label="Segnala un problema"
          active={report.open}
          onClick={report.openReport}
        />
        {report.modal}
        <SidebarAccount />
        {/* Last, where settings usually are. */}
        <UtilityButton
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Settings size={18} />
              {apiProblem && <SidebarBadge tone={apiProblem.tone} />}
            </span>
          }
          label={apiProblem ? `Impostazioni: ${apiProblem.label}` : 'Impostazioni'}
          ariaLabel="Apri impostazioni"
          ariaDescription={apiProblem ? `Attenzione: ${apiProblem.label}` : undefined}
          active={false}
          onClick={() => setIsSettingsOpen(true)}
          placement="top"
        />
      </div>
    </nav>
  );
});

function NavItem({
  icon, label, active, onClick, isProcessing, ariaLabel,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  isProcessing?: boolean;
  ariaLabel?: string;
}) {
  return (
    <SidebarTooltip label={label} disabled={active}>
      <button
        onClick={onClick}
        aria-label={ariaLabel || label}
        className="sidebar-nav-item w-9 h-9 flex items-center justify-center rounded-lg group/nav"
        style={{
          background: active ? 'var(--sidebar-active-bg)' : 'transparent',
          color: active ? 'var(--sidebar-active-text)' : 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: 'none',
        }}
      >
        <span className="inline-flex items-center justify-center" style={{ position: 'relative', color: active ? 'var(--sidebar-active-text)' : 'var(--text-muted)', lineHeight: 0 }}>
          {icon}
          {isProcessing && <SidebarBadge tone="processing" />}
        </span>
      </button>
    </SidebarTooltip>
  );
}

function UtilityButton({
  icon, label, ariaLabel, ariaDescription, active, onClick, placement = 'right', anchorId, className,
}: {
  icon: ReactNode;
  label: string;
  ariaLabel?: string;
  /** Read after the name, so the name stays the same for the tests and screen-reader users. */
  ariaDescription?: string;
  active: boolean;
  onClick: () => void;
  placement?: 'right' | 'top';
  /** Lets the panel this button opens point its caret at it. */
  anchorId?: string;
  /** Extra classes, e.g. the theme toggle's animation shared with the editor. */
  className?: string;
}) {
  return (
    <SidebarTooltip label={label} disabled={active} placement={placement}>
      <button
        data-sidebar-anchor={anchorId}
        onClick={onClick}
        aria-label={ariaLabel || label}
        aria-description={ariaDescription}
        className={`sidebar-nav-item w-9 h-9 flex items-center justify-center rounded-lg group/util${className ? ` ${className}` : ''}`}
        style={{
          background: active ? 'var(--sidebar-active-bg)' : 'transparent',
          color: active ? 'var(--sidebar-active-text)' : 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span className="inline-flex items-center justify-center" style={{ color: active ? 'var(--sidebar-active-text)' : 'var(--text-muted)', lineHeight: 0 }}>
          {icon}
        </span>
      </button>
    </SidebarTooltip>
  );
}
