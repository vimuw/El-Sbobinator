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

export function WelcomeDashboard({ archiveSessions }: WelcomeDashboardProps) {
  const stats = useMemo(() => {
    const total = archiveSessions.length;
    const totalSec = archiveSessions.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);
    const now = new Date();
    const thisMonth = archiveSessions.filter(s => {
      if (!s.completed_at_iso) return false;
      try {
        const d = new Date(s.completed_at_iso);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      } catch {
        return false;
      }
    }).length;
    return { total, totalSec, thisMonth };
  }, [archiveSessions]);

  const hasSessions = stats.total > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="text-center space-y-2 py-3">
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
            value={String(stats.thisMonth)}
            label="Questo mese"
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
      whileHover={{ y: -5, scale: 1.03, boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20, delay }}
      className="premium-panel p-4 flex flex-col items-center gap-2 text-center"
      style={{ cursor: 'default' }}
    >
      <div style={{ color: 'var(--text-muted)' }}>{icon}</div>
      <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{value}</span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </motion.div>
  );
}
