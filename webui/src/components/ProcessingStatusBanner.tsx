import { memo, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { AnimatePresence, motion, useSpring, useTransform } from 'motion/react';
import { DURATION, EASE_IN, enterTransition, staggerContainer, staggerItem } from '../motion';
import {
  AudioLines,
  Bot,
  Check,
  FileDown,
  FileSearch,
  Files,
  Loader,
  MessageSquareOff,
  Mic,
  Pause,
  RefreshCw,
  ServerCrash,
  Sparkles,
  Timer,
  TriangleAlert,
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
  kind: 'normal' | 'cancel' | 'success';
};

// A problem the pipeline is recovering from. "wait" pauses the run; "retrying" redoes work right away.
type ProcessingNotice = {
  kind: 'wait' | 'retrying';
  icon: React.ReactElement;
  label: string;
  waitSecs: number | null;
  attempt: { current: number; total: number } | null;
  // What resumes when the countdown ends, or a fixed detail when there is no countdown.
  resumeLabel: string;
  detail?: string;
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

const ICON_CLASS = 'h-[18px] w-[18px]';
const NOTICE_ICON_CLASS = 'h-4 w-4';

function getPhaseInfo(appState: AppStatus, currentPhase: string): PhaseInfo {
  if (appState === 'canceling') {
    return { icon: <XCircle className={ICON_CLASS} />, iconAnimation: 'none', title: 'Interruzione in corso...', kind: 'cancel' };
  }

  const phase = currentPhase.trim();

  if (!phase) {
    return { icon: <Loader className={ICON_CLASS} />, iconAnimation: 'spin', title: 'Preparazione...', kind: 'normal' };
  }
  if (phase === '__completed__') {
    return { icon: <DrawnCheck />, iconAnimation: 'none', title: 'Sbobinatura completata!', kind: 'success' };
  }
  if (phase.startsWith('Fase: analisi')) {
    return { icon: <FileSearch className={ICON_CLASS} />, iconAnimation: 'none', title: 'Analisi del file audio', kind: 'normal' };
  }
  if (phase.startsWith('Fase 0/3')) {
    return { icon: <AudioLines className={ICON_CLASS} />, iconAnimation: 'none', title: 'Pre-conversione audio', kind: 'normal' };
  }
  if (phase.startsWith('Fase 1/3')) {
    return { icon: <Mic className={ICON_CLASS} />, iconAnimation: 'none', title: 'Trascrizione e sbobinatura', kind: 'normal' };
  }
  if (phase.startsWith('Fase 2/3')) {
    const isRetry = phase.includes('retry');
    return {
      icon: <Sparkles className={ICON_CLASS} />,
      iconAnimation: 'none',
      title: isRetry ? 'Revisione blocchi mancanti' : 'Revisione e pulizia',
      kind: 'normal',
    };
  }
  if (phase.startsWith('Fase: esportazione') || phase.startsWith('Fase:esportazione')) {
    return { icon: <FileDown className={ICON_CLASS} />, iconAnimation: 'none', title: 'Generazione output', kind: 'normal' };
  }

  return { icon: <Loader className={ICON_CLASS} />, iconAnimation: 'spin', title: 'Elaborazione in corso', kind: 'normal' };
}

function parseWaitSecs(phase: string): number | null {
  const match = phase.match(/(?:tra|attesa)\s+(\d+)\s*s\b/i);
  return match ? Number(match[1]) : null;
}

function parseAttempt(phase: string): { current: number; total: number } | null {
  const match = phase.match(/tentativo\s+(\d+)\s*\/\s*(\d+)/i);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
}

// The backend reports recoverable problems as phase messages (see generation_service.py and phase1_service.py).
// The console keeps the technical details; the banner says what is happening in plain words.
function getProcessingNotice(currentPhase: string): ProcessingNotice | null {
  const phase = currentPhase.trim();
  const waitSecs = parseWaitSecs(phase);
  const attempt = parseAttempt(phase);

  if (phase.startsWith('Server Gemini occupato')) {
    return {
      kind: 'wait',
      icon: <ServerCrash className={NOTICE_ICON_CLASS} />,
      label: 'Server Gemini sovraccarico',
      waitSecs,
      attempt,
      resumeLabel: 'nuovo tentativo',
    };
  }
  if (phase.includes('Rate limit')) {
    return {
      kind: 'wait',
      icon: <Pause className={NOTICE_ICON_CLASS} />,
      label: 'Limite di richieste al minuto raggiunto',
      waitSecs,
      attempt,
      resumeLabel: 'ripresa',
    };
  }
  if (phase.startsWith('Connessione assente')) {
    return {
      kind: 'wait',
      icon: <WifiOff className={NOTICE_ICON_CLASS} />,
      label: 'Connessione internet assente',
      waitSecs: null,
      attempt: null,
      resumeLabel: 'ripresa',
      detail: 'riprendo appena torna la rete',
    };
  }
  if (phase.startsWith('Risposta vuota da Gemini')) {
    return {
      kind: 'wait',
      icon: <MessageSquareOff className={NOTICE_ICON_CLASS} />,
      label: 'Gemini ha restituito una risposta vuota',
      waitSecs,
      attempt,
      resumeLabel: 'nuovo tentativo',
    };
  }
  if (phase.startsWith('Errore temporaneo di Gemini')) {
    return {
      kind: 'wait',
      icon: <TriangleAlert className={NOTICE_ICON_CLASS} />,
      label: 'Errore temporaneo di Gemini',
      waitSecs,
      attempt,
      resumeLabel: 'nuovo tentativo',
    };
  }
  if (phase.startsWith('Output non valido')) {
    return {
      kind: 'retrying',
      icon: <RefreshCw className={NOTICE_ICON_CLASS} />,
      label: phase.split(' — ')[0],
      waitSecs: null,
      attempt: null,
      resumeLabel: 'nuovo tentativo',
      detail: 'rigenero il blocco',
    };
  }
  return null;
}

// The success check draws itself once instead of popping in.
function DrawnCheck() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="drawn-check">
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

// Counts down from the moment the notice arrived; the row is keyed by message, so each retry restarts it.
function useCountdown(totalSecs: number | null): number | null {
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(shownAt);
  useEffect(() => {
    if (totalSecs === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [totalSecs]);
  if (totalSecs === null) return null;
  return Math.max(0, totalSecs - Math.floor((now - shownAt) / 1000));
}

function NoticeRow({ notice }: { notice: ProcessingNotice }) {
  const remaining = useCountdown(notice.waitSecs);
  let detail = notice.detail ?? '';
  if (remaining !== null) {
    detail = remaining > 0 ? `${notice.resumeLabel} tra ${remaining}s` : `${notice.resumeLabel} in corso…`;
  }
  if (notice.attempt) {
    detail += ` · tentativo ${notice.attempt.current} di ${notice.attempt.total}`;
  }

  return (
    <div className="processing-notice" data-testid="processing-notice" data-notice-kind={notice.kind}>
      <span className="flex shrink-0" aria-hidden="true">{notice.icon}</span>
      <span className="min-w-0 truncate">
        <span role="status" className="font-medium">{notice.label}</span>
        {detail && <span className="processing-notice-detail tabular-nums"> — {detail}</span>}
      </span>
    </div>
  );
}

function getStepperState(currentPhase: string): StepperState {
  const phase = currentPhase.trim();
  // Show the steps while preparing too, so the banner keeps its height when phase 0 starts.
  if (!phase || phase.startsWith('Fase: analisi')) {
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

function inferStepPhase(
  workDone: { chunks: number; macro: number },
  workTotals: { chunks: number; macro: number },
): string {
  if (workTotals.chunks > 0 && workDone.chunks >= workTotals.chunks) return 'Fase 2/3: revisione';
  if (workTotals.chunks > 0) return 'Fase 1/3: trascrizione';
  return '';
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s trascorsi`;
  const minutes = Math.floor(secs / 60);
  const remainingSeconds = secs % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}s trascorsi`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m trascorsi`;
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
  // While a problem is being handled, the banner keeps describing the step it interrupted.
  const phaseNotice = getProcessingNotice(currentPhase);
  const lastStepPhaseRef = useRef('');
  if (!phaseNotice) lastStepPhaseRef.current = currentPhase;
  // Mounted mid-problem (e.g. back from the archive), there is no remembered step: infer it from the counters.
  const stepPhase = phaseNotice
    ? lastStepPhaseRef.current || inferStepPhase(workDone, workTotals)
    : currentPhase;

  const { icon, iconAnimation, title, kind } = getPhaseInfo(appState, stepPhase);
  const notice = kind === 'cancel' ? null : phaseNotice;
  const isWaiting = notice?.kind === 'wait';
  const isDimmed = kind === 'cancel' || isWaiting;

  // Unrecognised status messages keep the last steps on screen instead of shrinking the banner.
  const lastStepperRef = useRef<StepperState>(null);
  const stepperState = getStepperState(stepPhase) ?? lastStepperRef.current;
  lastStepperRef.current = stepperState;
  const progressLabel = kind === 'normal' ? getProgressLabel(stepPhase, workDone, workTotals) : null;

  const [elapsedSecs, setElapsedSecs] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsedSecs(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

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

  const metaItems: Array<{ icon: React.ReactElement; label: string }> = [];
  if (currentModel && kind !== 'success') {
    metaItems.push({ icon: <Bot className="h-3.5 w-3.5" />, label: shortModelName(currentModel) });
  }
  if (currentBatchTotal > 1) {
    metaItems.push({ icon: <Files className="h-3.5 w-3.5" />, label: `File ${currentFileIndex + 1} di ${currentBatchTotal}` });
  }
  if (startedAt && elapsedSecs > 0 && kind !== 'success') {
    metaItems.push({ icon: <Timer className="h-3.5 w-3.5" />, label: formatElapsed(elapsedSecs) });
  }

  // The file is what the user recognises; the step becomes its subtitle.
  const heading = currentFileName || title;

  return (
    <motion.section
      {...staggerContainer}
      className="premium-panel relative w-full p-5 sm:p-6"
      data-kind={kind}
      data-waiting={isWaiting || undefined}
      aria-label="Stato elaborazione"
    >
      <div className="relative z-10 flex flex-col gap-5">
        <motion.div {...staggerItem} className="flex items-start gap-3">
          <span className="processing-banner-icon" style={{ background: accentSubtle, color: accentColor }}>
            <span className={iconAnimation === 'spin' ? 'flex animate-spin' : 'flex'}>{icon}</span>
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="processing-banner-title truncate" title={heading}>{heading}</h2>
            {/* popLayout crossfades step titles; "wait" left the subtitle empty between quick phases. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={title}
                initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: enterTransition() }}
                exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: DURATION.fast, ease: EASE_IN } }}
                className="truncate text-sm tabular-nums"
                style={{ color: 'var(--text-secondary)' }}
                data-testid="processing-step-title"
              >
                {currentFileName && <span style={{ color: accentColor }} className="font-medium">{title}</span>}
                {progressLabel && currentFileName && <span aria-hidden="true"> · </span>}
                {progressLabel && <span>{progressLabel}</span>}
              </motion.p>
            </AnimatePresence>
          </div>
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

        <AnimatePresence initial={false}>
          {notice && (
            <motion.div
              key="notice"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto', transition: enterTransition() }}
              exit={{ opacity: 0, height: 0, transition: { duration: DURATION.fast, ease: EASE_IN } }}
              className="-my-1 overflow-hidden py-1"
            >
              <NoticeRow key={currentPhase} notice={notice} />
            </motion.div>
          )}
        </AnimatePresence>

        {metaItems.length > 0 && (
          <motion.div
            {...staggerItem}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums"
            style={{ color: 'var(--text-secondary)', opacity: isDimmed ? 0.6 : 1, transition: 'opacity 0.3s' }}
          >
            {metaItems.map(({ icon, label }, index) => (
              <span key={index} className="flex items-center gap-1.5">
                <span className="flex" style={{ color: 'var(--text-muted)' }}>{icon}</span>
                {label}
              </span>
            ))}
          </motion.div>
        )}
      </div>
    </motion.section>
  );
});
