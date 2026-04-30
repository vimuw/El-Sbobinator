import { useMemo, useRef, useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { DndContext, closestCenter, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { motion, AnimatePresence } from 'motion/react';
import { FileAudio, MoreVertical, Play, Square, Trash2 } from 'lucide-react';
import type { AppStatus, FileItem } from '../appState';
import { shortModelName } from '../utils';
import { QueueFileCard } from './QueueFileCard';

interface QueueSectionProps {
  pendingFiles: FileItem[];
  appState: AppStatus;
  autoContinue: boolean;
  setAutoContinue: Dispatch<SetStateAction<boolean>>;
  preferredModel: string;
  queuedCount: number;
  canStart: boolean;
  hasApiKey: boolean;
  isApiKeyValid: boolean;
  currentPhase: string;
  dndSensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onRetry: (id: string) => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string) => void;
  onOpenFile: (path: string) => void;
  onStart: () => void;
  onStop: () => void;
}

export function QueueSection({
  pendingFiles, appState, autoContinue, setAutoContinue, preferredModel,
  queuedCount, canStart, hasApiKey, isApiKeyValid, currentPhase,
  dndSensors, onDragEnd, onRemove, onClearAll, onRetry, onPreview, onOpenFile,
  onStart, onStop,
}: QueueSectionProps) {
  const sortableIds = useMemo(() => pendingFiles.map(f => f.id), [pendingFiles]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
                  {preferredModel && (
                    <span className="status-pill shrink-0 whitespace-nowrap">{shortModelName(preferredModel)}</span>
                  )}
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
                <div
                  role="menu"
                  style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                    minWidth: '200px', zIndex: 50,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '10px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    padding: '4px',
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setAutoContinue(v => !v); }}
                    title="Avvia automaticamente il file successivo al termine di ogni sbobinatura"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      width: '100%', padding: '8px 12px', borderRadius: '7px',
                      border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '14px',
                      background: autoContinue ? 'var(--success-subtle)' : 'transparent',
                      color: autoContinue ? 'var(--success-text)' : 'var(--text-primary)',
                      fontWeight: autoContinue ? 600 : 400,
                      marginBottom: '2px',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = autoContinue ? 'var(--success-subtle)' : 'var(--bg-hover, var(--border-subtle))')}
                    onMouseLeave={e => (e.currentTarget.style.background = autoContinue ? 'var(--success-subtle)' : 'transparent')}
                  >
                    Coda automatica
                  </button>
                  {appState === 'idle' && pendingFiles.length > 0 && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { onClearAll(); setMenuOpen(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        width: '100%', padding: '8px 12px', borderRadius: '7px',
                        border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '14px',
                        background: 'transparent', color: 'var(--error-text)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--error-subtle)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Trash2 className="w-4 h-4" style={{ flexShrink: 0 }} />
                      Svuota coda
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} autoScroll={false}>
            <div
              style={{
                maxHeight: '26rem',
                overflowY: 'auto',
                overflowX: 'hidden',
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--border-default) transparent',
                padding: '4px 8px',
              }}
            >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-3" style={{ margin: '-4px -8px' }}>
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
                      {!hasApiKey ? '⚠️ Inserisci API Key nelle impostazioni' : !isApiKeyValid ? '⚠️ API Key non valida' : `Avvia sbobinatura (${queuedCount} file)`}
                    </button>
                  </motion.div>
                )}
                {appState === 'processing' && (
                  <motion.div key="processing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex justify-end">
                    <button onClick={onStop} className="premium-button-secondary compact-button is-danger px-5 py-2">
                      <Square className="w-3.5 h-3.5 fill-current" /> Stop
                    </button>
                  </motion.div>
                )}
                {appState === 'canceling' && (
                  <motion.div key="canceling" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex justify-end">
                    <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--error-text)', opacity: 0.75, cursor: 'wait' }}>
                      <Square className="w-3 h-3 fill-current" />
                      Annullamento in corso
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}
    </>
  );
}
