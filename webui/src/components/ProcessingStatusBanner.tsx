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
      icon: <XCircle className="w-8 h-8" />,
      iconAnimation: 'none',
      title: 'Interruzione in corso...',
      description: "Attendere il completamento dell'operazione corrente prima di fermarsi.",
      kind: 'cancel',
    };
  }

  const phase = currentPhase.trim();

  if (!phase) {
    return {
      icon: <Loader className="w-8 h-8" />,
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
      icon: <AudioLines className="w-8 h-8" />,
      iconAnimation: 'none',
      title: 'Pre-conversione audio',
      description: "Conversione del file audio in un formato ottimizzato per l'elaborazione.",
      kind: 'normal',
    };
  }

  if (phase.startsWith('Fase 1/3')) {
    return {
      icon: <Mic className="w-8 h-8" />,
      iconAnimation: 'none',
      title: 'Trascrizione e sbobinatura',
      description: 'Gemini trascrive e sbobina ogni blocco audio in appunti dettagliati.',
      kind: 'normal',
    };
  }

  if (phase.startsWith('Fase 2/3')) {
    const isRetry = phase.includes('retry');
    return {
      icon: <Sparkles className="w-8 h-8" />,
      iconAnimation: 'none',
      title: isRetry ? 'Revisione blocchi mancanti' : 'Revisione e pulizia',
      description: isRetry ? phase : 'Il testo viene rivisto e ripulito da ripetizioni e imprecisioni.',
      kind: 'normal',
    };
  }

  if (phase.startsWith('Fase: esportazione') || phase.startsWith('Fase:esportazione')) {
    return {
      icon: <FileDown className="w-8 h-8" />,
      iconAnimation: 'none',
      title: 'Generazione output',
      description: 'Salvataggio del file HTML finale sul Desktop.',
      kind: 'normal',
    };
  }

  if (phase.startsWith('Server Gemini occupato')) {
    return {
      icon: <WifiOff className="w-8 h-8" />,
      iconAnimation: 'none',
      title: 'In attesa...',
      description: phase,
      kind: 'wait',
    };
  }

  if (phase.startsWith('Rate limit') || phase.includes('Rate limit')) {
    return {
      icon: <Pause className="w-8 h-8" />,
      iconAnimation: 'none',
      title: 'Pausa automatica',
      description: 'Limite richieste API raggiunto. Ripresa automatica tra qualche secondo.',
      kind: 'wait',
    };
  }

  return {
    icon: <Loader className="w-8 h-8" />,
    iconAnimation: 'spin',
    title: 'Elaborazione in corso',
    description: currentPhase,
    kind: 'normal',
  };
}

// The success check draws itself once instead of popping in.
function DrawnCheck() {
  return (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="drawn-check">
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

function StepBadge({
  state,
  label,
  num,
  accentColor,
  tooltip,
}: {
  state: StepState;
  label: string;
  num: number;
  accentColor: string;
  tooltip: string;
}) {
  const wrapperStyle: React.CSSProperties = { color: 'var(--text-primary)' };

  const content = state === 'done'
    ? (
        <span className="flex items-center gap-2">
          <span className="flex items-center justify-center w-5 h-5 rounded-full shrink-0" style={{ background: 'var(--success-text)' }}>
            <Check className="w-3 h-3" style={{ color: 'white' }} />
          </span>
          <span className="text-xs line-through" style={{ color: 'var(--text-muted)' }}>{label}</span>
        </span>
      )
    : state === 'active'
      ? (
          <span className="flex items-center gap-2">
            <span className="relative flex items-center justify-center shrink-0">
              <span className="relative flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold" style={{ background: accentColor, color: 'white' }}>
                {num}
              </span>
            </span>
            <span className="text-sm font-semibold" style={{ color: accentColor }}>{label}</span>
          </span>
        )
      : (
          <span className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full border text-[10px] shrink-0" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
              {num}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
          </span>
        );

  return (
    <span
      className="group relative inline-flex focus:outline-none"
      style={wrapperStyle}
      tabIndex={0}
      aria-label={`${label}. ${tooltip}`}
    >
      <span className="cursor-help">{content}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-48 -translate-x-1/2 translate-y-1 rounded-xl border px-3 py-2 text-left text-[11px] leading-snug opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
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
  const isCanceling = appState === 'canceling';
  const isWaiting = kind === 'wait';

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

  const accentColor = isCanceling
    ? 'var(--error-text)'
    : kind === 'wait'
      ? 'var(--error-text)'
      : kind === 'success'
        ? 'var(--success-text)'
        : 'var(--processing-text)';

  const accentSubtle = isCanceling
    ? 'var(--error-subtle)'
    : kind === 'wait'
      ? 'var(--error-subtle)'
      : kind === 'success'
        ? 'var(--success-subtle)'
        : 'var(--processing-bg)';

  const progressFill = isCanceling
    ? 'linear-gradient(90deg, var(--error-bg), var(--error-text))'
    : kind === 'wait'
      ? 'linear-gradient(90deg, var(--error-bg), var(--error-text))'
      : kind === 'success'
        ? 'linear-gradient(90deg, var(--success-subtle), var(--success-text))'
        : 'linear-gradient(90deg, var(--accent-gradient-start), var(--accent-gradient-end))';

  const isDimmed = isCanceling || isWaiting;

  const metaChips: Array<{ icon: React.ReactElement; label: string }> = [];
  if (currentModel && kind !== 'success') {
    metaChips.push({ icon: <Bot className="w-3 h-3" />, label: shortModelName(currentModel) });
  }
  if (currentBatchTotal > 1) {
    metaChips.push({ icon: <Files className="w-3 h-3" />, label: `File ${currentFileIndex + 1} di ${currentBatchTotal}` });
  }
  if (startedAt && elapsedSecs > 0 && kind !== 'success') {
    metaChips.push({ icon: <Timer className="w-3 h-3" />, label: formatElapsed(elapsedSecs) });
  }
  if (progressLabel) {
    metaChips.push({ icon: <Layers className="w-3 h-3" />, label: progressLabel });
  }

  return (
    <motion.section
      {...staggerContainer}
      className="relative w-full px-5 py-6 sm:px-7 sm:py-7"
      aria-label="Stato elaborazione"
    >

      <div className="relative z-10 flex flex-col items-center gap-5 text-center">
        {/* popLayout crossfades phase titles; "wait" left the header empty between quick phases. */}
        <motion.div {...staggerItem} className="w-full">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: enterTransition() }}
            exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: DURATION.fast, ease: EASE_IN } }}
            className="flex flex-col items-center gap-5"
          >
            <div className="relative flex items-center justify-center">
              <div
                className="relative flex h-16 w-16 items-center justify-center rounded-full"
                style={{ background: accentSubtle, color: accentColor, transition: 'background 0.2s ease-out, color 0.2s ease-out' }}
              >
                <div className={iconAnimation === 'spin' ? 'animate-spin' : ''}>
                  {icon}
                </div>
              </div>
            </div>

            <div className="flex max-w-xl flex-col items-center gap-1.5">
              <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                {title}
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {description}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
        </motion.div>

        <motion.div {...staggerItem} className="flex flex-col items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-muted)' }}>
            Avanzamento
          </span>
          <span className="text-5xl font-bold leading-none tabular-nums" style={{ color: accentColor }} data-testid="progress-percent">
            <ProgressNumber value={activeProgress} />
          </span>
        </motion.div>

        <motion.div {...staggerItem} className="w-full max-w-2xl">
          <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--progress-bg)' }}>
            <motion.div
              className="processing-progress-fill h-full rounded-full"
              style={{ background: progressFill }}
              initial={{ width: 0 }}
              animate={{ width: `${activeProgress}%` }}
              transition={enterTransition(0.6)}
            />
          </div>
        </motion.div>

        {currentFileName && (
          <motion.p {...staggerItem} className="max-w-xl truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }} title={currentFileName}>
            {currentFileName}
          </motion.p>
        )}

        {(metaChips.length > 0 || stepperState) && (
          <motion.div
            {...staggerItem}
            className="flex flex-col items-center gap-3"
            style={isDimmed ? { opacity: 0.45, filter: 'grayscale(0.6)', transition: 'opacity 0.3s, filter 0.3s' } : undefined}
          >
            {metaChips.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {metaChips.map(({ icon, label }, index) => (
                  <span
                    key={`${label}-${index}`}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                    style={{ background: 'var(--progress-bg)', color: 'var(--text-secondary)' }}
                  >
                    {icon}
                    {label}
                  </span>
                ))}
              </div>
            )}
            {stepperState && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <StepBadge state={stepperState.preconversione} label="Pre-conversione" num={1} accentColor={isDimmed ? 'var(--text-muted)' : accentColor} tooltip={STEP_TOOLTIPS.preconversione} />
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--border-default)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                <StepBadge state={stepperState.trascrizione} label="Trascrizione" num={2} accentColor={isDimmed ? 'var(--text-muted)' : accentColor} tooltip={STEP_TOOLTIPS.trascrizione} />
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--border-default)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                <StepBadge state={stepperState.revisione} label="Revisione" num={3} accentColor={isDimmed ? 'var(--text-muted)' : accentColor} tooltip={STEP_TOOLTIPS.revisione} />
              </div>
            )}
          </motion.div>
        )}
      </div>
    </motion.section>
  );
});
