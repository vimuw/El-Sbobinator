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
  hasPendingUpdate: boolean;
}

export function NavSidebar({
  activePage, setActivePage,
  apiReady, bridgeDelayed, hasApiKey, isApiKeyValid, appState,
  themeMode, setThemeMode,
  showConsole, setShowConsole,
  setIsSettingsOpen,
  hasPendingUpdate,
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
        overflowX: 'hidden',
      }}
    >

      {/* Logo */}
      <div className="flex justify-start pt-3 pb-1" style={{ paddingLeft: 12 }}>
        <img src="/icon.png" alt="El Sbobinator" style={{ width: 32, height: 32, borderRadius: 8 }} />
      </div>

      {/* Navigation items */}
      <div className="flex flex-col gap-0.5 px-2 pt-2 pb-2 flex-1">
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
          isProcessing={appState === 'processing'}
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
            aria-label={apiStatusLabel}
            className="flex items-center gap-2 rounded-md text-xs font-medium"
            style={{
              color: apiStatusColor,
              padding: '0 10px',
              height: 30,
              justifyContent: 'flex-start',
            }}
          >
            <span className="shrink-0 inline-flex items-center justify-center" style={{ width: 18, height: 18, lineHeight: 0 }}>
              <span
                className={`inline-flex h-1.5 w-1.5 rounded-full ${appState === 'processing' ? 'animate-pulse' : ''}`}
                style={{ background: apiStatusColor }}
              />
            </span>
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
          collapsed={collapsed}
          onClick={() => setIsSettingsOpen(true)}
        />
      </div>
    </motion.nav>
  );
}

function SidebarTooltip({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="sidebar-tooltip-anchor"
      onMouseEnter={() => !disabled && setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      style={{ position: 'relative', display: 'block' }}
    >
      {children}
      <AnimatePresence>
        {visible && !disabled && (
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
  icon, label, active, onClick, isProcessing, collapsed,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  isProcessing?: boolean;
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
          padding: '0 10px',
          height: 32,
          justifyContent: 'flex-start',
        }}
      >
        <span className="shrink-0 inline-flex items-center" style={{ position: 'relative', color: active ? 'var(--sidebar-active-text)' : 'var(--text-muted)', lineHeight: 0 }}>
          {icon}
          {isProcessing && (
            <span style={{ position: 'absolute', top: -3, right: -3, display: 'inline-flex' }}>
              <span className="animate-ping" style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', background: 'var(--processing-dot)', opacity: 0.7 }} />
              <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: 'var(--processing-dot)', border: '1.5px solid var(--sidebar-bg)' }} />
            </span>
          )}
        </span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="nav-label"
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
          padding: '0 10px',
          height: 30,
          justifyContent: 'flex-start',
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
