import { memo, useMemo, useState, type ComponentType } from 'react';
import { motion } from 'motion/react';
import type { ArchiveSession } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';
import { fadeUp, staggerContainer, staggerItem } from '../motion';
import { BrandLogo } from './BrandLogo';
import { CalendarTickIcon, WaveformIcon, WritingDocIcon } from './StatIcons';

interface WelcomeDashboardProps {
  archiveSessions: ArchiveSession[];
  isArchiveLoaded?: boolean;
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

export const WelcomeDashboard = memo(function WelcomeDashboard({ archiveSessions, isArchiveLoaded = true }: WelcomeDashboardProps) {
  const [cachedHasSessions] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.HAS_SESSIONS_V1) === 'true';
    } catch (_) {
      return false;
    }
  });

  const stats = useMemo(() => {
    const total = archiveSessions.length;
    const totalSec = archiveSessions.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);
    const lastSession = formatLastSession(archiveSessions);
    return { total, totalSec, lastSession };
  }, [archiveSessions]);

  const hasSessions = stats.total > 0 || (!isArchiveLoaded && cachedHasSessions);

  return (
    <motion.div {...fadeUp} className="space-y-5">
      <div className="space-y-2 py-3">
        <div className="flex items-center gap-2.5">
          <h1 className="page-title min-w-0">
            {hasSessions ? 'Bentornato' : 'Benvenuto in El Sbobinator'}
          </h1>
          <BrandLogo size={36} />
        </div>
        <p className="text-base" style={{ color: 'var(--text-muted)' }}>
          {hasSessions
            ? 'Trascina un nuovo file audio o video per iniziare.'
            : 'Trascina un file audio o video per iniziare la prima sbobinatura.'}
        </p>
      </div>

      {stats.total > 0 && (
        <motion.div {...staggerContainer} className="grid grid-cols-3 gap-3">
          <StatCard index={0} Icon={WritingDocIcon} value={String(stats.total)} label="Sbobine completate" />
          <StatCard index={1} Icon={WaveformIcon} value={formatAudioDuration(stats.totalSec)} label="Audio elaborato" />
          <StatCard index={2} Icon={CalendarTickIcon} value={stats.lastSession} label="Ultima sbobina" />
        </motion.div>
      )}
    </motion.div>
  );
});

interface StatCardProps {
  index: number;
  Icon: ComponentType<{ run: number; delay?: number }>;
  value: string;
  label: string;
}

// Icons start once their card has faded in, one card after another.
const ICON_ENTRANCE_DELAY = 0.25;
const ICON_ENTRANCE_STEP = 0.15;

// A figure with its label above. The icon acts out the stat once on arrival and
// again on hover, then rests: nothing on the dashboard moves on its own.
function StatCard({ index, Icon, value, label }: StatCardProps) {
  const [run, setRun] = useState(0);
  return (
    <motion.div
      {...staggerItem}
      onMouseEnter={() => setRun(r => r + 1)}
      className="premium-panel stat-card px-4 py-3.5 flex flex-col gap-2 min-w-0"
    >
      <div className="flex items-center gap-2 text-xs font-medium min-w-0" style={{ color: 'var(--text-muted)' }}>
        <span className="stat-card-icon shrink-0">
          <Icon run={run} delay={run === 0 ? ICON_ENTRANCE_DELAY + index * ICON_ENTRANCE_STEP : 0} />
        </span>
        <span className="truncate">{label}</span>
      </div>
      <span className="text-2xl font-semibold leading-tight truncate" style={{ color: 'var(--text-primary)', letterSpacing: 'var(--tracking-display)' }}>
        {value}
      </span>
    </motion.div>
  );
}
