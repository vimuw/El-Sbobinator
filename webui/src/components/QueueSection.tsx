import { memo, useMemo, useRef, useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { DndContext, closestCenter, useSensors, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { motion, AnimatePresence } from 'motion/react';
import { FileAudio, MoreVertical, Play, Square, Trash2, Check, Zap } from 'lucide-react';
import type { AppStatus, FileItem } from '../appState';
import { shortModelName } from '../utils';
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
  canStart: boolean;
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
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string) => void;
  onOpenFile: (path: string) => void;
  onStart: () => void;
  onStop: () => void;
  onOpenSettings?: () => void;
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
    canStart,
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
    onPreview,
    onOpenFile,
    onStart,
    onStop,
    onOpenSettings,
  } = actions;
  const sortableIds = useMemo(() => pendingFiles.map(f => f.id), [pendingFiles]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <>
      {(pendingFiles.length > 0 || appState !== 'idle') && (
        <motion.div
          key="batch-queue"
          className="premium-panel p-5 sm:p-6 space-y-4"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
        >
          <div className="flex items-center justify-between gap-3 border-b pb-5" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2 shrink-0" style={{ color: 'var(--text-primary)' }}>
                <FileAudio className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                Coda di elaborazione
              </h2>
              {pendingFiles.length > 0 && (
                <>
                  <span className="status-pill shrink-0">{pendingFiles.length}</span>
                  {((appState === 'processing' || appState === 'canceling') && currentModel) ? (
                    <span className="status-pill shrink-0 whitespace-nowrap">{shortModelName(currentModel)}</span>
                  ) : preferredModel ? (
                    <span className="status-pill shrink-0 whitespace-nowrap">{shortModelName(preferredModel)}</span>
                  ) : null}
                </>
              )}
            </div>
            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                className="icon-button compact-icon-button"
                aria-label="Opzioni coda"
                title="Opzioni coda"
                onClick={() => setMenuOpen(v => !v)}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div role="menu" className="kebab-dropdown">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setAutoContinue(v => !v)}
                    title="Avvia automaticamente il file successivo al termine di ogni sbobinatura"
                    className={`kebab-item ${autoContinue ? 'is-active' : ''}`}
                  >
                    <Zap className="w-4 h-4 shrink-0" style={{ color: autoContinue ? 'var(--accent-text)' : 'var(--text-muted)' }} />
                    <span className="grow whitespace-nowrap">Coda automatica</span>
                    {autoContinue && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-text)' }} />}
                  </button>
                  {appState === 'idle' && pendingFiles.length > 0 && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { onClearAll(); setMenuOpen(false); }}
                      className="kebab-item is-danger"
                    >
                      <Trash2 className="w-4 h-4 shrink-0" />
                      <span>Svuota coda</span>
                    </button>
                  )}
                </div>
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
              className="app-scroll overflow-y-auto overflow-x-hidden"
              style={{
                maxHeight: 'clamp(260px, calc(100vh - 360px), 520px)',
                padding: '4px 6px',
                overscrollBehavior: 'contain',
              }}
            >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
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
                      showDragHandle={pendingFiles.length >= 2}
                    />
                  );
                })}
              </AnimatePresence>
              </div>
            </SortableContext>
            </div>
          </DndContext>

          {(appState !== 'idle' || queuedCount > 0) && (
            <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <AnimatePresence mode="wait">
                {appState === 'idle' && (
                  <motion.div key="idle" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <button onClick={onStart} disabled={!canStart}
                      className={`premium-button w-full text-lg${canStart ? ' premium-button--ready' : ''}`}
                      style={canStart ? {} : { cursor: 'not-allowed' }}>
                      <Play className="w-5 h-5 fill-current" />
                      {!isOnline ? '⚠️ Connessione Internet assente' : !hasApiKey ? '⚠️ Inserisci API Key nelle impostazioni' : !isApiKeyValid ? '⚠️ API Key non valida' : `Avvia sbobinatura (${queuedCount} file)`}
                    </button>
                  </motion.div>
                )}
                {appState === 'processing' && (
                  <motion.div key="processing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <button onClick={onStop} className="premium-button is-danger w-full text-lg">
                      <Square className="w-5 h-5 fill-current" />
                      Interrompi elaborazione
                    </button>
                  </motion.div>
                )}
                {appState === 'canceling' && (
                  <motion.div key="canceling" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <button disabled className="premium-button is-danger w-full text-lg" style={{ opacity: 0.65, cursor: 'wait' }}>
                      <Square className="w-5 h-5 fill-current animate-pulse" />
                      Annullamento in corso...
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}
    </>
  );
});
