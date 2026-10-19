import { memo, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { ArchiveSession } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';
import { fadeUp } from '../motion';
import { BrandLogo } from './BrandLogo';

interface WelcomeDashboardProps {
  archiveSessions: ArchiveSession[];
  isArchiveLoaded?: boolean;
}

// Spoken Italian, not a dashboard figure: "18 ore", "1 ora e 20 minuti", "45 minuti".
// Under a minute there is nothing worth saying, so the caller leaves the duration out.
function formatSpokenDuration(totalSec: number): string | null {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const hours = `${h} ${h === 1 ? 'ora' : 'ore'}`;
  const minutes = `${m} ${m === 1 ? 'minuto' : 'minuti'}`;
  // Past ten hours the minutes are noise.
  if (h >= 10 || (h > 0 && m === 0)) return hours;
  if (h > 0) return `${hours} e ${minutes}`;
  if (m > 0) return minutes;
  return null;
}

// A friendly line under the greeting, not a stats panel: something nice to read on arrival.
function ArchiveSummary({ total, totalSec }: { total: number; totalSec: number }) {
  const duration = formatSpokenDuration(totalSec);
  const figure = (text: string) => <strong className="welcome-summary-figure">{text}</strong>;
  if (total === 1) {
    return (
      <p className="welcome-summary" data-testid="welcome-summary">
        Hai sbobinato la tua {figure('prima lezione')}
        {duration ? <>: {figure(duration)} di audio.</> : '.'}
      </p>
    );
  }
  return (
    <p className="welcome-summary" data-testid="welcome-summary">
      Finora hai sbobinato {figure(`${total} lezioni`)}
      {duration ? <>, per un totale di {figure(duration)} di audio.</> : '.'}
    </p>
  );
}

export const WelcomeDashboard = memo(function WelcomeDashboard({ archiveSessions, isArchiveLoaded = true }: WelcomeDashboardProps) {
  const [cachedHasSessions] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.HAS_SESSIONS_V1) === 'true';
    } catch (_) {
      return false;
    }
  });

  const stats = useMemo(() => ({
    total: archiveSessions.length,
    totalSec: archiveSessions.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0),
  }), [archiveSessions]);

  const hasSessions = stats.total > 0 || (!isArchiveLoaded && cachedHasSessions);

  return (
    <motion.div {...fadeUp} className="space-y-5">
      <div className="space-y-2 py-3">
        <div className="flex items-center gap-2.5">
          <h1 className="page-title min-w-0">
            {hasSessions ? 'Bentornato' : 'Benvenuto in El Sbobinator'}
          </h1>
          <BrandLogo size={36} greetOncePerSession={hasSessions} />
        </div>
        {/* With an archive the line under the greeting tells what was done so far;
            the drop target right below already says how to start. */}
        {stats.total > 0 ? (
          <ArchiveSummary total={stats.total} totalSec={stats.totalSec} />
        ) : (
          <p className="text-base" style={{ color: 'var(--text-muted)' }}>
            {hasSessions
              ? 'Trascina un nuovo file audio o video per iniziare.'
              : 'Trascina un file audio o video per iniziare la prima sbobinatura.'}
          </p>
        )}
      </div>
    </motion.div>
  );
});
