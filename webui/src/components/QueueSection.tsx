import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { DndContext, closestCenter, useSensors, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { motion, AnimatePresence } from 'motion/react';
import { fade, fadeUp } from '../motion';
import { AlertTriangle, Play, RotateCcw, Trash2, Plus } from 'lucide-react';
import type { AppStatus, FileItem } from '../appState';
import { formatDuration, shortModelName } from '../utils';
import { QueueFileCard } from './QueueFileCard';

export interface QueueSectionProgressProps {
  appState: AppStatus;
  currentPhase: string;
  currentModel?: string;
}

export interface QueueSectionAuthProps {
  preferredModel: string;
}

export interface QueueSectionStatusProps {
  queuedCount: number;
  failedCount?: number;
  canStart: boolean;
  canResumeAll?: boolean;
  hasApiKey: boolean;
  isApiKeyValid: boolean;
  isOnline?: boolean;
  autoContinue: boolean;
  setAutoContinue: Dispatch<SetStateAction<boolean>>;
}

export interface QueueSectionDndProps {
  sensors: SensorDescriptor<SensorOptions>[] | ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
}

export interface QueueSectionActionProps {
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onRetry: (id: string) => void;
  onResumeAll?: () => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string) => void;
  onOpenFile: (path: string) => void;
  onStart: () => void;
  onOpenSettings?: () => void;
  onAddFiles?: () => void;
}

export interface QueueSectionProps {
  pendingFiles: FileItem[];
  progress: QueueSectionProgressProps;
  auth: QueueSectionAuthProps;
  status: QueueSectionStatusProps;
  dnd: QueueSectionDndProps;
  actions: QueueSectionActionProps;
}

export const QueueSection = memo(function QueueSection({
  pendingFiles,
  progress,
  auth,
  status,
  dnd,
  actions,
}: QueueSectionProps) {
  const { appState, currentPhase, currentModel } = progress;
  const { preferredModel } = auth;
  const {
    queuedCount,
    failedCount = 0,
    canStart,
    canResumeAll = false,
    hasApiKey,
    isApiKeyValid,
    isOnline = true,
    autoContinue,
    setAutoContinue,
  } = status;
  const { sensors, onDragEnd } = dnd;
  const {
    onRemove,
    onClearAll,
    onRetry,
    onResumeAll,
    onPreview,
    onOpenFile,
    onStart,
    onOpenSettings,
    onAddFiles,
  } = actions;
  const sortableIds = useMemo(() => pendingFiles.map(f => f.id), [pendingFiles]);
  const isBusy = appState === 'processing' || appState === 'canceling';
  const canReorder = useMemo(() => {
    const nonProcessingCount = isBusy
      ? pendingFiles.filter(f => f.status !== 'processing').length
      : pendingFiles.length;
    return nonProcessingCount >= 2;
  }, [isBusy, pendingFiles]);
  const hintId = useId();

  const isVisible = pendingFiles.length > 0 || appState !== 'idle';

  // The list scrolls inside a scrolling page, so files past the fold get a fade that says "there is more".
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const updateMoreBelow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHasMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    updateMoreBelow();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    // Cards collapse on exit, so the height changes after pendingFiles does.
    const observer = new ResizeObserver(updateMoreBelow);
    observer.observe(list);
    return () => observer.disconnect();
  }, [isVisible, updateMoreBelow]);

  // Total audio still to transcribe; files without a known duration are left out and flagged with "+".
  const audioTotal = useMemo(() => {
    const waiting = pendingFiles.filter(f => f.status !== 'processing' && f.status !== 'done');
    const known = waiting.filter(f => f.duration > 0);
    const seconds = known.reduce((sum, f) => sum + f.duration, 0);
    if (seconds <= 0) return '';
    return `${formatDuration(seconds)}${known.length < waiting.length ? '+' : ''}`;
  }, [pendingFiles]);

  const blockedReason = !isOnline
    ? 'Connessione Internet assente: ricollegati per avviare.'
    : !hasApiKey
      ? 'Inserisci API Key nelle impostazioni per avviare.'
      : !isApiKeyValid
        ? 'API Key non valida: controllala nelle impostazioni.'
        : null;
  const needsSettings = isOnline && (!hasApiKey || !isApiKeyValid);
  const showStart = appState === 'idle' && queuedCount > 0;
  const showResumeAll = appState === 'idle' && queuedCount === 0 && failedCount > 0 && Boolean(onResumeAll);
  const startHint = showStart && !canStart
    ? blockedReason ?? 'Nessun file pronto da avviare.'
    : showResumeAll && !canResumeAll
      ? blockedReason ?? 'Nessun file da riprendere.'
      : null;
  const activeModel = isBusy && currentModel ? currentModel : preferredModel;

  return (
    <>
      {isVisible && (
        <motion.div
          key="batch-queue"
          className="dashboard-section"
          {...fadeUp}
        >
          <div className="dashboard-section-header">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="dashboard-section-title shrink-0">In coda</h2>
              {pendingFiles.length > 0 && (
                <>
                  <span className="status-pill is-quiet shrink-0">{pendingFiles.length}</span>
                  {activeModel && (
                    <span className="status-pill is-quiet shrink-0 whitespace-nowrap" title={activeModel}>{shortModelName(activeModel)}</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={autoContinue}
                onClick={() => setAutoContinue(v => !v)}
                title="Avvia automaticamente il file successivo al termine di ogni sbobinatura"
                className="queue-switch"
              >
                <span className="queue-switch-track" aria-hidden="true"><span className="queue-switch-thumb" /></span>
                Coda automatica
              </button>
              {onAddFiles && appState === 'processing' && (
                <button
                  type="button"
                  onClick={onAddFiles}
                  className="icon-button compact-icon-button shrink-0"
                  title="Aggiungi file audio alla coda"
                  aria-label="Aggiungi audio"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            autoScroll={{ threshold: { x: 0, y: 0.2 }, acceleration: 10 }}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <div
              ref={scrollRef}
              onScroll={updateMoreBelow}
              className={`queue-list-scroll overflow-x-hidden overflow-y-auto app-scroll is-chainable max-h-[360px] py-0.5${hasMoreBelow ? ' has-more-below' : ''}`}
            >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div ref={listRef} className="space-y-0.5">
              <AnimatePresence>
                {pendingFiles.map((file) => {
                  const isActive = file.status === 'processing';
                  return (
                    <QueueFileCard
                      key={file.id}
                      file={file}
                      appState={appState}
                      currentPhase={isActive ? currentPhase : undefined}
                      onRemove={onRemove}
                      onRetry={(id) => onRetry(id)}
                      onPreview={onPreview}
                      onOpenFile={onOpenFile}
                      onOpenSettings={onOpenSettings}
                      showDragHandle={canReorder}
                    />
                  );
                })}
              </AnimatePresence>
              </div>
            </SortableContext>
            </div>
          </DndContext>

          {(showStart || showResumeAll || startHint || (appState === 'idle' && pendingFiles.length > 0)) && (
          <div className="pt-3 space-y-3">
            {/* Same-size buttons crossfade in place instead of bobbing up and down. */}
            <AnimatePresence mode="wait" initial={false}>
              {showStart && (
                <motion.div key="idle" {...fade}>
                  <button onClick={onStart} disabled={!canStart}
                    aria-describedby={startHint ? hintId : undefined}
                    className="premium-button queue-start-button w-full">
                    <Play className="w-5 h-5 fill-current" />
                    <span>{`Avvia sbobinatura (${queuedCount + failedCount} file)`}</span>
                    {audioTotal && (
                      <span className="queue-start-meta" title="Durata totale dell'audio da sbobinare">{`· ${audioTotal} di audio`}</span>
                    )}
                  </button>
                </motion.div>
              )}
              {showResumeAll && (
                <motion.div key="resume-all" {...fade}>
                  <button onClick={onResumeAll} disabled={!canResumeAll}
                    aria-describedby={startHint ? hintId : undefined}
                    className="premium-button queue-start-button w-full">
                    <RotateCcw className="w-5 h-5" />
                    <span>{`Riprendi elaborazione (${failedCount} file)`}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {startHint && (
              <p id={hintId} role="status" className="queue-start-hint">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{startHint}</span>
                {needsSettings && onOpenSettings && (
                  <button type="button" className="queue-text-button" onClick={onOpenSettings}>
                    Apri impostazioni
                  </button>
                )}
              </p>
            )}

            {appState === 'idle' && pendingFiles.length > 0 && (
              <div className="flex justify-end">
                <button type="button" onClick={onClearAll} className="queue-text-button is-danger">
                  <Trash2 className="w-3.5 h-3.5" />
                  Svuota coda
                </button>
              </div>
            )}
          </div>
          )}
        </motion.div>
      )}
    </>
  );
});
