import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Archive, Moon, Settings, Sun, Terminal } from 'lucide-react';
import type { AppStatus } from '../appState';

export type ActivePage = 'queue' | 'archive';

const SIDEBAR_EXPANDED_W = 216;
const SIDEBAR_COLLAPSED_W = 56;

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
  isDismissed: boolean;
}

export function NavSidebar({
  activePage, setActivePage,
  apiReady, bridgeDelayed, hasApiKey, isApiKeyValid, appState,
  themeMode, setThemeMode,
  showConsole, setShowConsole,
  setIsSettingsOpen,
  isDismissed,
}: NavSidebarProps) {
  const [hovered, setHovered] = useState(false);
  const collapsed = !hovered;

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
    <motion.nav
      className="app-sidebar flex flex-col"
      animate={{ width: collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W }}
      initial={false}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: '100vh',
        position: 'sticky',
        top: 0,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-subtle)',
        flexShrink: 0,
        zIndex: 30,
        overflowY: 'auto',
      }}
    >

      {/* Navigation items */}
      <div className="flex flex-col gap-0.5 px-2 py-2 flex-1">
        <NavItem
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          }
          label="Dashboard"
          active={activePage === 'queue'}
          onClick={() => setActivePage('queue')}
          badge={appState === 'processing' ? <HourglassAnim /> : undefined}
          collapsed={collapsed}
        />
        <NavItem
          icon={<Archive size={20} />}
          label="Archivio"
          active={activePage === 'archive'}
          onClick={() => setActivePage('archive')}
          collapsed={collapsed}
        />
      </div>

      {/* Utility buttons */}
      <div className="px-2 pb-4 flex flex-col gap-0.5" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        {/* API status */}
        <SidebarTooltip label={apiStatusLabel} disabled={!collapsed}>
          <div
            className="flex items-center gap-2 rounded-md text-xs font-medium"
            style={{
              color: apiStatusColor,
              padding: collapsed ? '6px 0' : '6px 10px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              minHeight: 28,
            }}
          >
            <span
              className={`inline-flex h-1.5 w-1.5 rounded-full shrink-0 ${appState === 'processing' ? 'animate-pulse' : ''}`}
              style={{ background: apiStatusColor }}
            />
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.span
                  key="api-label"
                  className="truncate"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
                >
                  {apiStatusLabel}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </SidebarTooltip>

        <UtilityButton
          icon={themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          label={themeMode === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
          active={false}
          collapsed={collapsed}
          onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
        />
        <UtilityButton
          icon={<Terminal size={18} />}
          label="Console"
          ariaLabel="Mostra console"
          active={showConsole}
          collapsed={collapsed}
          onClick={() => {
            const next = !showConsole;
            setShowConsole(next);
            localStorage.setItem('show_console', String(next));
          }}
        />
        <UtilityButton
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Settings size={18} />
              {isDismissed && (
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
          collapsed={collapsed}
          onClick={() => setIsSettingsOpen(true)}
        />
      </div>
    </motion.nav>
  );
}

function SidebarTooltip({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  if (disabled) return <>{children}</>;
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

function HourglassAnim() {
  return (
    <svg className="hg-svg" viewBox="0 0 16 20" width="13" height="13" aria-hidden="true">
      <defs>
        <clipPath id="hg-clip-t">
          <polygon points="1,1 15,1 9,9 7,9" />
        </clipPath>
        <clipPath id="hg-clip-b">
          <polygon points="7,11 9,11 15,19 1,19" />
        </clipPath>
      </defs>
      <polygon points="1,1 15,1 9,9 7,9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <polygon points="7,11 9,11 15,19 1,19" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <line x1="7" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="7" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect className="hg-sand-t" x="1" y="1" width="14" height="8" clipPath="url(#hg-clip-t)" fill="currentColor" opacity="0.65" />
      <rect className="hg-sand-b" x="1" y="19" width="14" height="0" clipPath="url(#hg-clip-b)" fill="currentColor" opacity="0.65" />
    </svg>
  );
}

function NavItem({
  icon, label, active, onClick, badge, collapsed,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: ReactNode;
  collapsed: boolean;
}) {
  return (
    <SidebarTooltip label={label} disabled={!collapsed}>
      <button
        onClick={onClick}
        className="sidebar-nav-item w-full flex items-center rounded-md text-sm font-medium text-left"
        style={{
          background: active ? 'var(--sidebar-active-bg)' : 'transparent',
          color: active ? 'var(--sidebar-active-text)' : 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
          fontWeight: active ? 600 : 500,
          gap: collapsed ? 0 : 8,
          padding: collapsed ? '6px 0' : '6px 10px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <span className="shrink-0 inline-flex items-center" style={{ color: active ? 'var(--sidebar-active-text)' : 'var(--text-muted)', lineHeight: 0 }}>{icon}</span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="nav-label"
              className="truncate flex-1"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
        {!collapsed && badge && <span className="text-xs shrink-0">{badge}</span>}
      </button>
    </SidebarTooltip>
  );
}

function UtilityButton({
  icon, label, ariaLabel, active, onClick, collapsed,
}: {
  icon: ReactNode;
  label: string;
  ariaLabel?: string;
  active: boolean;
  onClick: () => void;
  collapsed: boolean;
}) {
  return (
    <SidebarTooltip label={label} disabled={!collapsed}>
      <button
        onClick={onClick}
        aria-label={ariaLabel}
        className="sidebar-nav-item w-full flex items-center rounded-md text-xs font-medium text-left"
        style={{
          background: active ? 'var(--sidebar-active-bg)' : 'transparent',
          color: active ? 'var(--sidebar-active-text)' : 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
          gap: collapsed ? 0 : 8,
          padding: collapsed ? '6px 0' : '6px 10px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <span className="shrink-0 inline-flex items-center" style={{ color: active ? 'var(--sidebar-active-text)' : 'var(--text-muted)', lineHeight: 0 }}>{icon}</span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="util-label"
              className="truncate"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </SidebarTooltip>
  );
}
