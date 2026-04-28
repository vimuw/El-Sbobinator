import { useCallback, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Archive, Moon, Settings, Sun, Terminal } from 'lucide-react';
import type { AppStatus } from '../appState';

const CONFETTI_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF922B', '#CC5DE8', '#FF8FAB'];
type ConfettiParticle = { id: number; color: string; angle: number; distance: number; size: number; round: boolean };

export type ActivePage = 'queue' | 'archive';

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
  const [confettiParticles, setConfettiParticles] = useState<ConfettiParticle[]>([]);
  const confettiIdRef = useRef(0);
  const lastConfettiRef = useRef(0);

  const fireConfetti = useCallback(() => {
    const now = Date.now();
    if (now - lastConfettiRef.current < 350) return;
    lastConfettiRef.current = now;
    const particles: ConfettiParticle[] = Array.from({ length: 14 }, () => ({
      id: confettiIdRef.current++,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      angle: Math.random() * 360,
      distance: 28 + Math.random() * 34,
      size: 3 + Math.floor(Math.random() * 4),
      round: Math.random() > 0.45,
    }));
    setConfettiParticles(prev => [...prev, ...particles]);
    setTimeout(() => {
      setConfettiParticles(prev => prev.filter(p => !particles.some(pp => pp.id === p.id)));
    }, 850);
  }, []);

  const titleGradient = {
    background: 'linear-gradient(90deg, var(--gradient-title-from), var(--gradient-title-to))',
    WebkitBackgroundClip: 'text' as const,
    WebkitTextFillColor: 'transparent',
  };

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
        width: 220,
        minWidth: 220,
        maxWidth: 220,
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
      <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ position: 'relative', display: 'inline-block' }} onMouseEnter={fireConfetti}>
          <div className="flex items-center gap-2">
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <img src="./icon.png" alt="El Sbobinator" className="app-logo" draggable={false} style={{ width: 32, height: 32 }} />
              {confettiParticles.map(p => {
                const rad = (p.angle * Math.PI) / 180;
                const tx = Math.cos(rad) * p.distance;
                const ty = Math.sin(rad) * p.distance - 8;
                return (
                  <motion.span
                    key={p.id}
                    initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                    animate={{ x: tx, y: ty, opacity: 0, scale: 0.4 }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      marginLeft: -p.size / 2,
                      marginTop: -p.size / 2,
                      width: p.size,
                      height: p.size,
                      borderRadius: p.round ? '50%' : '2px',
                      background: p.color,
                      pointerEvents: 'none',
                      zIndex: 50,
                    }}
                  />
                );
              })}
            </span>
            <h1 className="brand-mark text-[1.45rem] font-semibold flex items-baseline tracking-tight leading-none overflow-visible py-1">
              <span style={titleGradient}>El&nbsp;</span>
              <span className="relative inline-block mx-[1px] overflow-visible">
                <svg className="absolute -top-[10px] left-1/2 -translate-x-[42%] w-[20px] h-[30px] drop-shadow-md z-10 pointer-events-none" viewBox="0 0 32 50" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: 'rotate(-10deg)' }}>
                  <path d="M 3 22 C 5 40, 12 48, 17 48 C 23 48, 28 38, 29 22" fill="none" stroke="#D19A3F" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="17" cy="48" r="2" fill="#D96D42" />
                  <circle cx="17" cy="48" r="1" fill="#F5D57F" />
                  <path d="M 2 22 C 2 18, 30 18, 30 22" fill="#C38243"/>
                  <path d="M 9 18 C 9 18, 11 4, 16 4 C 21 4, 23 18, 23 18 Z" fill="#F2C86F"/>
                  <path d="M 9.5 15 Q 16 17 22.5 15 L 23 18 Q 16 20 9.5 15 Z" fill="#D96D42"/>
                  <path d="M 10 12 Q 16 14 22 12 L 22.5 15 Q 16 17 10 15 Z" fill="#2B9B7D"/>
                  <path d="M 10.5 9 Q 16 11 21.5 9 L 22 12 Q 16 14 10.5 12 Z" fill="#FFF5E4"/>
                  <path d="M 2 22 C 2 28, 30 28, 30 22 C 30 20, 25 18, 16 18 C 7 18, 2 20, 2 22 Z" fill="#F2C86F"/>
                  <path d="M 2 22 C 2 28, 30 28, 30 22" fill="none" stroke="#C38243" strokeWidth="1.5"/>
                </svg>
                <span className="relative z-0" style={titleGradient}>S</span>
              </span>
              <span style={titleGradient}>bobinator</span>
            </h1>
          </div>
        </div>
      </div>

      {/* Navigation items */}
      <div className="flex flex-col gap-1 px-3 py-3 flex-1">
        <NavItem
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          }
          label="Sbobinatura"
          active={activePage === 'queue'}
          onClick={() => setActivePage('queue')}
          badge={appState === 'processing' ? <HourglassAnim /> : undefined}
        />
        <NavItem
          icon={<Archive size={16} />}
          label="Archivio"
          active={activePage === 'archive'}
          onClick={() => setActivePage('archive')}
        />
      </div>

      {/* Utility buttons */}
      <div className="px-3 pb-4 flex flex-col gap-1" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
        {/* API status */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
          style={{ color: apiStatusColor }}
        >
          <span
            className={`inline-flex h-2 w-2 rounded-full shrink-0 ${appState === 'processing' ? 'animate-pulse' : ''}`}
            style={{ background: apiStatusColor }}
          />
          <span className="truncate">{apiStatusLabel}</span>
        </div>

        <UtilityButton
          icon={themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          label={themeMode === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
          active={false}
          onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
        />
        <UtilityButton
          icon={<Terminal size={15} />}
          label="Console"
          ariaLabel="Mostra console"
          active={showConsole}
          onClick={() => {
            const next = !showConsole;
            setShowConsole(next);
            localStorage.setItem('show_console', String(next));
          }}
        />
        <UtilityButton
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Settings size={15} />
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
          onClick={() => setIsSettingsOpen(true)}
        />
      </div>
    </nav>
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
  icon, label, active, onClick, badge,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="sidebar-nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-left"
      style={{
        background: active ? 'var(--sidebar-active-bg)' : 'transparent',
        color: active ? 'var(--sidebar-active-text)' : 'var(--text-muted)',
        border: active ? '1px solid var(--border-default)' : '1px solid transparent',
        cursor: 'pointer',
      }}
    >
      <span className="shrink-0" style={{ color: active ? 'var(--sidebar-active-text)' : 'var(--text-faint)' }}>{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {badge && <span className="text-xs">{badge}</span>}
    </button>
  );
}

function UtilityButton({
  icon, label, ariaLabel, active, onClick,
}: {
  icon: ReactNode;
  label: string;
  ariaLabel?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="sidebar-nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-left"
      style={{
        background: active ? 'var(--sidebar-active-bg)' : 'transparent',
        color: active ? 'var(--sidebar-active-text)' : 'var(--text-muted)',
        border: active ? '1px solid var(--border-default)' : '1px solid transparent',
        cursor: 'pointer',
      }}
    >
      <span className="shrink-0" style={{ color: active ? 'var(--sidebar-active-text)' : 'var(--text-faint)' }}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
