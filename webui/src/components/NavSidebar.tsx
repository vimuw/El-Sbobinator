import { memo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Archive, Bell, Moon, Settings, Sun, Terminal } from 'lucide-react';
import type { AppStatus } from '../appState';
export type ActivePage = 'queue' | 'archive';

const SIDEBAR_COLLAPSED_W = 64;

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
  showConsole: boolean;
  setShowConsole: (v: boolean) => void;
  setIsSettingsOpen: (v: boolean) => void;
  hasPendingUpdate: boolean;
  consoleDisabled: boolean;
  unreadNotificationsCount: number;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: Dispatch<SetStateAction<boolean>>;
  shakeBell: boolean;
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
  showConsole, setShowConsole,
  setIsSettingsOpen,
  hasPendingUpdate,
  consoleDisabled,
  unreadNotificationsCount,
  isNotificationsOpen,
  setIsNotificationsOpen,
  shakeBell,
}: NavSidebarProps) {
  const apiStatusColor = !apiReady
    ? (bridgeDelayed ? 'var(--error-text)' : 'var(--warning-text)')
    : !hasApiKey ? 'var(--text-muted)'
    : !isApiKeyValid ? 'var(--warning-text)'
    : 'var(--success-text)';

  const apiStatusLabel = !apiReady
    ? (bridgeDelayed ? 'Bridge in ritardo' : 'Connessione…')
    : !hasApiKey ? 'Configura API'
    : !isApiKeyValid ? 'Chiave non valida'
    : 'API pronta';

  return (
    <nav
      className="app-sidebar flex flex-col"
      style={{
        width: SIDEBAR_COLLAPSED_W,
        height: '100vh',
        position: 'sticky',
        top: 0,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-subtle)',
        flexShrink: 0,
        zIndex: 30,
        overflow: 'visible',
      }}
    >
      {/* Logo */}
      <div className="flex justify-center pt-3 pb-1">
        <img src="/icon.png" alt="El Sbobinator" style={{ width: 36, height: 36, borderRadius: 9 }} />
      </div>

      {/* Navigation items */}
      <div className="flex flex-col items-center gap-1.5 px-2 pt-2 pb-2 flex-1">
        <NavItem
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          }
          label="Dashboard"
          active={activePage === 'queue'}
          onClick={() => setActivePage('queue')}
          isProcessing={appState === 'processing'}
        />
        <NavItem
          icon={<Archive size={22} />}
          label="Archivio"
          active={activePage === 'archive'}
          onClick={() => setActivePage('archive')}
        />
      </div>

      {/* Utility buttons */}
      <div className="px-2 pb-4 flex flex-col items-center gap-1.5" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        {/* API status */}
        <SidebarTooltip label={apiStatusLabel}>
          <div
            aria-label={apiStatusLabel}
            className="flex items-center justify-center rounded-lg text-xs font-medium w-11 h-9 cursor-default"
            style={{ color: apiStatusColor }}
          >
            <span className="shrink-0 inline-flex items-center justify-center" style={{ width: 20, height: 20, lineHeight: 0 }}>
              <span
                className={`inline-flex h-2 w-2 rounded-full ${appState === 'processing' ? 'animate-pulse' : ''}`}
                style={{ background: apiStatusColor }}
              />
            </span>
          </div>
        </SidebarTooltip>

        <UtilityButton
          icon={themeMode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          label={themeMode === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
          active={false}
          onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
        />
        <UtilityButton
          icon={<Terminal size={20} />}
          label="Console"
          ariaLabel="Mostra console"
          active={showConsole}
          onClick={() => {
            const next = !showConsole;
            setShowConsole(next);
            localStorage.setItem('show_console', String(next));
          }}
          disabled={!hasApiKey || !isApiKeyValid || consoleDisabled}
        />
        <UtilityButton
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <motion.span
                variants={bellVariants}
                animate={shakeBell ? 'shake' : 'idle'}
                style={{ display: 'inline-flex' }}
              >
                <Bell size={20} />
              </motion.span>
              {unreadNotificationsCount > 0 && (
                <span style={{ position: 'absolute', top: -3, right: -3, display: 'inline-flex' }}>
                  <span className="animate-ping" style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', background: '#b91c1c', opacity: 0.6 }} />
                  <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: '#b91c1c', border: '1.5px solid var(--sidebar-bg)' }} />
                </span>
              )}
            </span>
          }
          label={unreadNotificationsCount > 0 ? `Notifiche (${unreadNotificationsCount})` : 'Notifiche'}
          ariaLabel="Apri notifiche"
          active={isNotificationsOpen}
          onClick={() => setIsNotificationsOpen(prev => !prev)}
        />
        <UtilityButton
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Settings size={20} />
              {hasPendingUpdate && (
                <span style={{ position: 'absolute', top: -3, right: -3, display: 'inline-flex' }}>
                  <span className="animate-ping" style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', background: 'var(--warning-text)', opacity: 0.6 }} />
                  <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: 'var(--warning-text)', border: '1.5px solid var(--sidebar-bg)' }} />
                </span>
              )}
            </span>
          }
          label="Impostazioni"
          ariaLabel="Apri impostazioni"
          active={false}
          onClick={() => setIsSettingsOpen(true)}
        />
      </div>
    </nav>
  );
});

function SidebarTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="sidebar-tooltip-anchor"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      style={{ position: 'relative', display: 'block' }}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.span
            className="sidebar-tooltip"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.12 }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

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
    <SidebarTooltip label={label}>
      <button
        onClick={onClick}
        aria-label={ariaLabel || label}
        className="sidebar-nav-item w-11 h-10 flex items-center justify-center rounded-lg"
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
          {isProcessing && (
            <span style={{ position: 'absolute', top: -3, right: -3, display: 'inline-flex' }}>
              <span className="animate-ping" style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', background: 'var(--processing-dot)', opacity: 0.7 }} />
              <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: 'var(--processing-dot)', border: '1.5px solid var(--sidebar-bg)' }} />
            </span>
          )}
        </span>
      </button>
    </SidebarTooltip>
  );
}

function UtilityButton({
  icon, label, ariaLabel, active, onClick, disabled,
}: {
  icon: ReactNode;
  label: string;
  ariaLabel?: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <SidebarTooltip label={disabled ? 'Console non disponibile' : label}>
      <button
        onClick={onClick}
        aria-label={ariaLabel || label}
        disabled={disabled}
        className="sidebar-nav-item w-11 h-9 flex items-center justify-center rounded-lg"
        style={{
          background: active ? 'var(--sidebar-active-bg)' : 'transparent',
          color: disabled ? 'var(--text-muted)' : (active ? 'var(--sidebar-active-text)' : 'var(--text-secondary)'),
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <span className="inline-flex items-center justify-center" style={{ color: disabled ? 'var(--text-muted)' : (active ? 'var(--sidebar-active-text)' : 'var(--text-muted)'), lineHeight: 0 }}>
          {icon}
        </span>
      </button>
    </SidebarTooltip>
  );
}
