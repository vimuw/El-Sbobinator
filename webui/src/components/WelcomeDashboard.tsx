import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { motion, useAnimation, type TargetAndTransition } from 'motion/react';
import { CalendarDays, FileText } from 'lucide-react';
import type { ArchiveSession } from '../bridge';

interface WelcomeDashboardProps {
  archiveSessions: ArchiveSession[];
}

function formatAudioDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '< 1m';
}

function formatLastSession(archiveSessions: ArchiveSession[]): string {
  if (archiveSessions.length === 0) return '—';
  let latest: Date | null = null;
  for (const s of archiveSessions) {
    if (!s.completed_at_iso) continue;
    try {
      const d = new Date(s.completed_at_iso);
      if (!latest || d > latest) latest = d;
    } catch { /* skip */ }
  }
  if (!latest) return '—';
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const latestStart = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate());
  const diffDays = Math.round((todayStart.getTime() - latestStart.getTime()) / 86400000);
  if (diffDays === 0) return 'Oggi';
  if (diffDays === 1) return 'Ieri';
  if (diffDays > 1) return `${diffDays} giorni fa`;
  return latest.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24" height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <motion.g
        style={{ transformOrigin: '12px 12px', transformBox: 'view-box' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 48, repeat: Infinity, ease: 'linear' }}
      >
        <line x1="12" y1="12" x2="12" y2="7" />
      </motion.g>
      <motion.g
        style={{ transformOrigin: '12px 12px', transformBox: 'view-box' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
      >
        <line x1="12" y1="12" x2="12" y2="5" />
      </motion.g>
    </svg>
  );
}

export function WelcomeDashboard({ archiveSessions }: WelcomeDashboardProps) {
  const stats = useMemo(() => {
    const total = archiveSessions.length;
    const totalSec = archiveSessions.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);
    const lastSession = formatLastSession(archiveSessions);
    return { total, totalSec, lastSession };
  }, [archiveSessions]);

  const hasSessions = stats.total > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="space-y-2 py-3">
        <h1 className="text-4xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          {hasSessions ? 'Bentornato 👋' : 'Benvenuto in El Sbobinator 👋'}
        </h1>
        <p className="text-base" style={{ color: 'var(--text-muted)' }}>
          {hasSessions
            ? 'Trascina un nuovo file audio o video per iniziare.'
            : 'Trascina un file audio o video per iniziare la prima sbobinatura.'}
        </p>
      </div>

      {hasSessions && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            icon={<FileText className="w-6 h-6" />}
            value={String(stats.total)}
            label="Sbobine completate"
            delay={0}
            iconIdleAnim={{ rotateY: [0, -180, -180, -360, -360], transition: { times: [0, 0.25, 0.35, 0.60, 1], duration: 4, repeat: Infinity, ease: ['easeInOut', 'linear', 'easeInOut', 'linear'] } }}
          />
          <StatCard
            icon={<ClockIcon />}
            value={formatAudioDuration(stats.totalSec)}
            label="Audio elaborato"
            delay={0.05}
            iconIdleAnim={{ opacity: 1 }}
          />
          <StatCard
            icon={<CalendarDays className="w-6 h-6" />}
            value={stats.lastSession}
            label="Ultima sbobina"
            delay={0.1}
            iconIdleAnim={{ rotateY: [0, -180, -180, -360, -360], transition: { times: [0, 0.25, 0.35, 0.60, 1], duration: 4.5, repeat: Infinity, ease: ['easeInOut', 'linear', 'easeInOut', 'linear'] } }}
          />
        </div>
      )}
    </motion.div>
  );
}

interface AnimatedStatIconProps {
  children: ReactNode;
  idleAnim: TargetAndTransition;
  delay: number;
}

function AnimatedStatIcon({ children, idleAnim, delay }: AnimatedStatIconProps) {
  const controls = useAnimation();
  const mountedRef = useRef(true);
  const idleAnimRef = useRef(idleAnim);
  const delayRef = useRef(delay);

  useEffect(() => {
    idleAnimRef.current = idleAnim;
  }, [idleAnim]);

  useEffect(() => {
    delayRef.current = delay;
  }, [delay]);

  useEffect(() => {
    mountedRef.current = true;
    async function run() {
      await controls.start({
        scale: 1,
        opacity: 1,
        rotate: 0,
        rotateY: 0,
        y: 0,
        transition: { type: 'spring', stiffness: 350, damping: 18, delay: delayRef.current },
      });
      if (mountedRef.current) {
        controls.start(idleAnimRef.current);
      }
    }
    run();
    return () => { mountedRef.current = false; };
  }, [controls]);

  return (
    <div style={{ perspective: '160px', display: 'inline-flex' }}>
      <motion.div
        style={{ display: 'inline-flex' }}
      >
        <motion.div
          initial={{ scale: 0, opacity: 0, rotate: -20 }}
          animate={controls}
          style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}

interface StatCardProps {
  icon: ReactNode;
  value: string;
  label: string;
  delay: number;
  iconIdleAnim: TargetAndTransition;
}

function StatCard({ icon, value, label, delay, iconIdleAnim }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20, delay }}
      className="premium-panel stat-card p-4 flex flex-col items-center gap-2 text-center"
      style={{ cursor: 'default' }}
    >
      <AnimatedStatIcon idleAnim={iconIdleAnim} delay={delay}>
        {icon}
      </AnimatedStatIcon>
      <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{value}</span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </motion.div>
  );
}
