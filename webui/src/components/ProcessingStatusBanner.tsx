import { memo, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { AnimatePresence, motion, useSpring, useTransform } from 'motion/react';
import { DURATION, EASE_IN, enterTransition, staggerContainer, staggerItem } from '../motion';
import {
  AudioLines,
  Bot,
  Check,
  FileDown,
  Files,
  Hourglass,
  Layers,
  Loader,
  Mic,
  Pause,
  Sparkles,
  Timer,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { shortModelName } from '../utils';
import type { AppStatus } from '../appState';

interface ProcessingStatusBannerProps {
  appState: AppStatus;
  currentPhase: string;
  currentModel: string;
  activeProgress: number;
  workDone: { chunks: number; macro: number };
  workTotals: { chunks: number; macro: number };
  currentFileIndex: number;
  currentBatchTotal: number;
  currentFileName?: string;
  startedAt?: number;
}

type PhaseInfo = {
  icon: React.ReactElement;
  // Only the indeterminate loader moves; during real phases the progress bar is the one live signal.
  iconAnimation: 'spin' | 'none';
  title: string;
  description: string;
  kind: 'normal' | 'wait' | 'cancel' | 'success';
};

type StepState = 'done' | 'active' | 'pending';
type StepKey = 'preconversione' | 'trascrizione' | 'revisione';
type StepperState = Record<StepKey, StepState> | null;
type WorkKind = 'chunks' | 'macro';

const STEP_TOOLTIPS: Record<StepKey, string> = {
  preconversione: "Normalizza l'audio per renderlo più stabile e leggibile nelle fasi successive.",
  trascrizione: 'Il modello analizza i blocchi audio e genera la prima sbobinatura dettagliata.',
  revisione: "Il testo viene ripulito, organizzato e reso più chiaro sezione per sezione.",
};

function getPhaseInfo(appState: AppStatus, currentPhase: string): PhaseInfo {
  if (appState === 'canceling') {
    return {
      icon: <XCircle className="h-[18px] w-[18px]" />,
      iconAnimation: 'none',
      title: 'Interruzione in corso...',
      description: "Attendere il completamento dell'operazione corrente prima di fermarsi.",
      kind: 'cancel',
    };
  }

  const phase = currentPhase.trim();

  if (!phase) {
    return {
      icon: <Loader className="h-[18px] w-[18px]" />,
      iconAnimation: 'spin',
      title: 'Preparazione...',
      description: "Avvio dell'elaborazione in corso.",
      kind: 'normal',
    };
  }

  if (phase === '__completed__') {
    return {
      icon: <DrawnCheck />,
      iconAnimation: 'none',
      title: 'Sbobinatura completata!',
      description: 'Tutti i passaggi sono stati completati con successo.',
      kind: 'success',
    };
  }

  if (phase.startsWith('Fase 0/3')) {
    return {
      icon: <AudioLines className="h-[18px] w-[18px]" />,
      iconAnimation: 'none',
      title: 'Pre-conversione audio',
      description: "Conversione del file audio in un formato ottimizzato per l'elaborazione.",
      kind: 'normal',
    };
  }

  if (phase.startsWith('Fase 1/3')) {
    return {
      icon: <Mic className="h-[18px] w-[18px]" />,
      iconAnimation: 'none',
      title: 'Trascrizione e sbobinatura',
      description: 'Gemini trascrive e sbobina ogni blocco audio in appunti dettagliati.',
      kind: 'normal',
    };
  }

  if (phase.startsWith('Fase 2/3')) {
    const isRetry = phase.includes('retry');
    return {
      icon: <Sparkles className="h-[18px] w-[18px]" />,
      iconAnimation: 'none',
      title: isRetry ? 'Revisione blocchi mancanti' : 'Revisione e pulizia',
      description: isRetry ? phase : 'Il testo viene rivisto e ripulito da ripetizioni e imprecisioni.',
      kind: 'normal',
    };
  }

  if (phase.startsWith('Fase: esportazione') || phase.startsWith('Fase:esportazione')) {
    return {
      icon: <FileDown className="h-[18px] w-[18px]" />,
      iconAnimation: 'none',
      title: 'Generazione output',
      description: 'Salvataggio del file HTML finale sul Desktop.',
      kind: 'normal',
    };
  }

  if (phase.startsWith('Server Gemini occupato')) {
    return {
      icon: <WifiOff className="h-[18px] w-[18px]" />,
      iconAnimation: 'none',
      title: 'In attesa...',
      description: phase,
      kind: 'wait',
    };
  }

  if (phase.startsWith('Rate limit') || phase.includes('Rate limit')) {
    return {
      icon: <Pause className="h-[18px] w-[18px]" />,
      iconAnimation: 'none',
      title: 'Pausa automatica',
      description: 'Limite richieste API raggiunto. Ripresa automatica tra qualche secondo.',
      kind: 'wait',
    };
  }

  return {
    icon: <Loader className="h-[18px] w-[18px]" />,
    iconAnimation: 'spin',
    title: 'Elaborazione in corso',
    description: currentPhase,
    kind: 'normal',
  };
}

// The success check draws itself once instead of popping in.
function DrawnCheck() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="drawn-check">
      <motion.circle cx="12" cy="12" r="10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={enterTransition(DURATION.slow * 1.5)} />
      <motion.path d="m9 12 2 2 4-4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={enterTransition(DURATION.slow, DURATION.slow)} />
    </svg>
  );
}

// Percent counts up smoothly instead of jumping; overdamped so it never passes the target.
function ProgressNumber({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 90, damping: 30 });
  const rounded = useTransform(spring, latest => `${Math.round(Math.min(100, Math.max(0, latest)))}%`);
  useEffect(() => { spring.set(value); }, [spring, value]);
  return <motion.span>{rounded}</motion.span>;
}

function getStepperState(currentPhase: string): StepperState {
  const phase = currentPhase.trim();
  // Show the steps while preparing too, so the banner keeps its height when phase 0 starts.
  if (!phase) {
    return { preconversione: 'pending', trascrizione: 'pending', revisione: 'pending' };
  }
  if (phase === '__completed__' || phase.startsWith('Fase: esportazione') || phase.startsWith('Fase:esportazione')) {
    return { preconversione: 'done', trascrizione: 'done', revisione: 'done' };
  }
  if (phase.startsWith('Fase 0/3')) {
    return { preconversione: 'active', trascrizione: 'pending', revisione: 'pending' };
  }
  if (phase.startsWith('Fase 1/3')) {
    return { preconversione: 'done', trascrizione: 'active', revisione: 'pending' };
  }
  if (phase.startsWith('Fase 2/3')) {
    return { preconversione: 'done', trascrizione: 'done', revisione: 'active' };
  }
  return null;
}

function parseCurrentIndex(phase: string, stage: WorkKind): { current: number; total: number } | null {
  if (stage === 'chunks') {
    const match = phase.match(/chunk\s+(\d+)\s*\/\s*(\d+)/i);
    if (match) {
      return { current: Number(match[1]), total: Number(match[2]) };
    }
  }

  if (stage === 'macro' && phase.startsWith('Fase 2/3')) {
    const match = phase.match(/\((?:blocco\s+)?(\d+)\s*\/\s*(\d+)\)/i);
    if (match) {
      return { current: Number(match[1]), total: Number(match[2]) };
    }
  }

  return null;
}

function getActiveStepIndex(done: number, total: number): number {
  if (total <= 0) return 0;
  if (done >= total) return total;
  return Math.min(total, Math.max(1, done + 1));
}

function getProgressLabel(
  currentPhase: string,
  workDone: { chunks: number; macro: number },
  workTotals: { chunks: number; macro: number },
): string | null {
  const phase = currentPhase.trim();

  const chunkInfo = parseCurrentIndex(phase, 'chunks');
  if (chunkInfo) return `Blocco ${chunkInfo.current} di ${chunkInfo.total}`;
  if (phase.startsWith('Fase 1/3') && workTotals.chunks > 0) {
    return `Blocco ${getActiveStepIndex(workDone.chunks, workTotals.chunks)} di ${workTotals.chunks}`;
  }

  const macroInfo = parseCurrentIndex(phase, 'macro');
  const macroCurrentNum = macroInfo
    ? macroInfo.current
    : getActiveStepIndex(workDone.macro, workTotals.macro);
  const macroTotalNum = macroInfo ? macroInfo.total : workTotals.macro;

  if (phase.startsWith('Fase 2/3') && macroTotalNum > 0) {
    return `Sezione ${macroCurrentNum} di ${macroTotalNum}`;
  }

  return null;
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `Da ${secs}s`;
  const minutes = Math.floor(secs / 60);
  const remainingSeconds = secs % 60;
  if (minutes < 60) return `Da ${minutes}m ${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `Da ${hours}h ${remainingMinutes}m`;
}

// Early estimates are noise: wait for some real progress and some elapsed time.
const ETA_MIN_PROGRESS = 5;
const ETA_MIN_ELAPSED_SECS = 20;
// Each tick moves the shown estimate a fifth of the way towards the new one.
const ETA_SMOOTHING = 0.2;

function formatRemaining(secs: number): string {
  const rawMinutes = Math.round(secs / 60);
  if (rawMinutes < 1) return 'meno di un minuto rimanente';
  // Long runs round to 5 minutes so the figure does not flicker every few seconds.
  const minutes = rawMinutes > 10 ? Math.round(rawMinutes / 5) * 5 : rawMinutes;
  if (minutes < 60) return `circa ${minutes} min rimanenti`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `circa ${hours} h ${restMinutes} min rimanenti` : `circa ${hours} h rimanenti`;
}

function useRemainingSecs(elapsedSecs: number, progress: number, enabled: boolean, startedAt?: number): number | null {
  const [smoothed, setSmoothed] = useState<number | null>(null);
  const eligible = enabled && progress >= ETA_MIN_PROGRESS && progress < 100 && elapsedSecs >= ETA_MIN_ELAPSED_SECS;

  useEffect(() => { setSmoothed(null); }, [startedAt]);

  useEffect(() => {
    if (!eligible) return;
    const raw = (elapsedSecs * (100 - progress)) / progress;
    setSmoothed(prev => (prev === null ? raw : prev + ETA_SMOOTHING * (raw - prev)));
  }, [eligible, elapsedSecs, progress]);

  return eligible ? smoothed : null;
}

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'preconversione', label: 'Pre-conversione' },
  { key: 'trascrizione', label: 'Trascrizione' },
  { key: 'revisione', label: 'Revisione' },
];

// Overall progress is 0-70% for transcription and 70-90% for revision (see the pipeline services).
function getActiveFraction(
  step: StepKey,
  activeProgress: number,
  workDone: { chunks: number; macro: number },
  workTotals: { chunks: number; macro: number },
): number {
  if (step === 'trascrizione') {
    return workTotals.chunks > 0 ? workDone.chunks / workTotals.chunks : activeProgress / 70;
  }
  if (step === 'revisione') {
    return workTotals.macro > 0 ? workDone.macro / workTotals.macro : (activeProgress - 70) / 20;
  }
  return 0;
}

// An active segment always shows a sliver so it reads as started.
const ACTIVE_MIN_FILL = 0.04;

function StepLabel({ state, label, accentColor, tooltip }: { state: StepState; label: string; accentColor: string; tooltip: string }) {
  const color = state === 'active' ? accentColor : state === 'done' ? 'var(--text-secondary)' : 'var(--text-muted)';
  return (
    <span
      className="processing-step-label group relative inline-flex min-w-0 focus:outline-none"
      tabIndex={0}
      aria-label={`${label}. ${tooltip}`}
    >
      <span className={`flex cursor-help items-center gap-1 truncate text-xs ${state === 'active' ? 'font-semibold' : 'font-medium'}`} style={{ color, transition: 'color 0.2s ease-out' }}>
        {state === 'done' && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
        {label}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-48 translate-y-1 rounded-xl border px-3 py-2 text-left text-[11px] leading-snug opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-secondary)',
          boxShadow: 'var(--shadow-strong)',
        }}
      >
        {tooltip}
      </span>
    </span>
  );
}

export const ProcessingStatusBanner = memo(function ProcessingStatusBanner({
  appState,
  currentPhase,
  currentModel,
  activeProgress,
  workDone,
  workTotals,
  currentFileIndex,
  currentBatchTotal,
  currentFileName,
  startedAt,
}: ProcessingStatusBannerProps) {
  const { icon, iconAnimation, title, description, kind } = getPhaseInfo(appState, currentPhase);
  const isWaiting = kind === 'wait';
  const isDimmed = kind === 'cancel' || isWaiting;

  const lastNormalPhaseRef = useRef('');
  if (kind === 'normal') lastNormalPhaseRef.current = currentPhase;
  const phaseForMeta = isWaiting ? lastNormalPhaseRef.current : currentPhase;

  // Unrecognised status messages keep the last steps on screen instead of shrinking the banner.
  const lastStepperRef = useRef<StepperState>(null);
  const stepperState = getStepperState(phaseForMeta) ?? lastStepperRef.current;
  lastStepperRef.current = stepperState;
  const progressLabel = getProgressLabel(phaseForMeta, workDone, workTotals);

  const [elapsedSecs, setElapsedSecs] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsedSecs(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Retries restart the progress scale, so only steady phases feed the estimate.
  const isRetry = currentPhase.includes('retry');
  const remainingSecs = useRemainingSecs(elapsedSecs, activeProgress, kind === 'normal' && !isRetry && Boolean(startedAt), startedAt);

  const accentColor = kind === 'cancel'
    ? 'var(--error-text)'
    : isWaiting
      ? 'var(--warning-text)'
      : kind === 'success'
        ? 'var(--success-text)'
        : 'var(--processing-text)';

  const accentSubtle = kind === 'cancel'
    ? 'var(--error-subtle)'
    : isWaiting
      ? 'var(--warning-subtle)'
      : kind === 'success'
        ? 'var(--success-subtle)'
        : 'var(--processing-bg)';

  const metaItems: Array<{ icon: React.ReactElement; label: string; testId?: string }> = [];
  if (currentModel && kind !== 'success') {
    metaItems.push({ icon: <Bot className="h-3.5 w-3.5" />, label: shortModelName(currentModel) });
  }
  if (currentBatchTotal > 1) {
    metaItems.push({ icon: <Files className="h-3.5 w-3.5" />, label: `File ${currentFileIndex + 1} di ${currentBatchTotal}` });
  }
  if (progressLabel) {
    metaItems.push({ icon: <Layers className="h-3.5 w-3.5" />, label: progressLabel });
  }
  if (startedAt && elapsedSecs > 0 && kind !== 'success') {
    metaItems.push({ icon: <Timer className="h-3.5 w-3.5" />, label: formatElapsed(elapsedSecs) });
  }
  if (remainingSecs !== null) {
    metaItems.push({ icon: <Hourglass className="h-3.5 w-3.5" />, label: formatRemaining(remainingSecs), testId: 'remaining-time' });
  }

  return (
    <motion.section
      {...staggerContainer}
      className="relative w-full px-5 py-6 sm:px-7 sm:py-7"
      data-kind={kind}
      aria-label="Stato elaborazione"
    >
      <div className="relative z-10 flex flex-col gap-5">
        {/* popLayout crossfades phase titles; "wait" left the header empty between quick phases. */}
        <motion.div {...staggerItem} className="w-full">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: enterTransition() }}
              exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: DURATION.fast, ease: EASE_IN } }}
              className="flex items-start gap-3"
            >
              <span className="processing-banner-icon" style={{ background: accentSubtle, color: accentColor }}>
                <span className={iconAnimation === 'spin' ? 'flex animate-spin' : 'flex'}>{icon}</span>
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="section-title">{title}</h2>
                {/* One line keeps the banner height stable when long status messages arrive. */}
                <p className="truncate text-sm" style={{ color: 'var(--text-secondary)' }} title={description}>
                  {description}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <motion.div {...staggerItem} className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div
              className="flex flex-1 gap-1.5"
              role="progressbar"
              aria-label="Avanzamento"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={activeProgress}
              style={{ opacity: isDimmed ? 0.55 : 1, transition: 'opacity 0.3s' }}
            >
              {STEPS.map(({ key }) => {
                const state = stepperState?.[key] ?? 'pending';
                const fraction = state === 'done'
                  ? 1
                  : state === 'active'
                    ? Math.max(ACTIVE_MIN_FILL, Math.min(1, getActiveFraction(key, activeProgress, workDone, workTotals)))
                    : 0;
                return (
                  <div key={key} className="phase-segment" data-testid={`phase-segment-${key}`} data-state={state}>
                    <motion.div
                      className="phase-segment-fill"
                      style={{ background: accentColor }}
                      initial={false}
                      animate={{ width: `${fraction * 100}%` }}
                      transition={enterTransition(0.6)}
                    />
                  </div>
                );
              })}
            </div>
            <span className="processing-percent" style={{ color: accentColor }} data-testid="progress-percent">
              <ProgressNumber value={activeProgress} />
            </span>
          </div>
          {stepperState && (
            <div className="processing-step-labels grid grid-cols-3 gap-1.5">
              {STEPS.map(({ key, label }) => (
                <StepLabel
                  key={key}
                  state={stepperState[key]}
                  label={label}
                  accentColor={isDimmed ? 'var(--text-muted)' : accentColor}
                  tooltip={STEP_TOOLTIPS[key]}
                />
              ))}
            </div>
          )}
        </motion.div>

        <motion.div
          {...staggerItem}
          className="flex min-w-0 flex-col gap-1.5"
          style={{ opacity: isDimmed ? 0.6 : 1, transition: 'opacity 0.3s' }}
        >
          {currentFileName && (
            <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }} title={currentFileName}>
              {currentFileName}
            </p>
          )}
          {metaItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {metaItems.map(({ icon, label, testId }) => (
                <span key={testId ?? label} className="flex items-center gap-1.5" data-testid={testId}>
                  <span className="flex" style={{ color: 'var(--text-muted)' }}>{icon}</span>
                  {label}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </motion.section>
  );
});
