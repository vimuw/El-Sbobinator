import { useMemo, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { CalendarDays, Clock, FileText } from 'lucide-react';
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
            icon={<FileText className="w-5 h-5" />}
            value={String(stats.total)}
            label="Sbobine completate"
            delay={0}
          />
          <StatCard
            icon={<Clock className="w-5 h-5" />}
            value={formatAudioDuration(stats.totalSec)}
            label="Audio elaborato"
            delay={0.05}
          />
          <StatCard
            icon={<CalendarDays className="w-5 h-5" />}
            value={stats.lastSession}
            label="Ultima sbobina"
            delay={0.1}
          />
        </div>
      )}
    </motion.div>
  );
}

interface StatCardProps {
  icon: ReactNode;
  value: string;
  label: string;
  delay: number;
}

function StatCard({ icon, value, label, delay }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5, scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20, delay }}
      className="premium-panel stat-card p-4 flex flex-col items-center gap-2 text-center"
      style={{ cursor: 'default' }}
    >
      <motion.div
        whileHover={{ scale: 1.2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        style={{ color: 'var(--text-muted)' }}
      >{icon}</motion.div>
      <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{value}</span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </motion.div>
  );
}
