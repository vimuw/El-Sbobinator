import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, Search, Trash2 } from 'lucide-react';
import type { AppStatus, FileItem } from '../appState';
import type { ArchiveFolder } from '../bridge';
import { CompletedFileCard } from './QueueFileCard';
import { normalizeSessionPath } from '../utils';

interface CompletedSectionProps {
  doneFiles: FileItem[];
  appState: AppStatus;
  onRemove: (id: string) => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string) => void;
  onOpenFile: (path: string) => void;
  onClearAll: () => void;
  onRetryFailedRevisionBlocks?: (sessionDir: string, fileId?: string) => Promise<void>;
  sessionFolderMap?: Map<string, ArchiveFolder>;
}

export function CompletedSection({ doneFiles, appState, onRemove, onPreview, onOpenFile, onClearAll, onRetryFailedRevisionBlocks, sessionFolderMap }: CompletedSectionProps) {
  const [completedSearch, setCompletedSearch] = useState('');

  const filteredDoneFiles = completedSearch.trim()
    ? doneFiles.filter(f => f.name.toLowerCase().includes(completedSearch.toLowerCase()))
    : doneFiles;
  const warningCount = doneFiles.filter(f => f.completionStatus === 'completed_with_warnings' || (f.revisionFailedBlocks?.length ?? 0) > 0).length;
  const fullyCompletedCount = doneFiles.length - warningCount;

  return (
    <>
      {doneFiles.length > 0 && (
        <motion.div
          key="completed-section"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="premium-panel p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <CheckCircle className="w-5 h-5" style={{ color: 'var(--success-text)' }} />
                Sbobine completate
              </h2>
              <span className="status-pill self-start sm:self-auto shrink-0 whitespace-nowrap" style={{ color: 'var(--success-text)', borderColor: 'var(--success-ring)', background: 'rgba(255,255,255,0.03)' }}>
                {fullyCompletedCount} complete{warningCount > 0 ? ` · ${warningCount} con avvisi` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {doneFiles.length >= 5 && (
                <div className="notion-search-wrap" style={{ width: '140px' }}>
                  <Search className="notion-search-icon w-3.5 h-3.5" />
                  <input
                    type="text"
                    value={completedSearch}
                    onChange={e => setCompletedSearch(e.target.value)}
                    placeholder="Cerca..."
                    className="notion-search-input"
                  />
                </div>
              )}
              {(appState === 'idle' || appState === 'processing') && (
                <button
                  onClick={onClearAll}
                  className="icon-button compact-icon-button"
                  style={{ color: 'var(--text-muted)' }}
                  title="Pulisci tutto"
                  aria-label="Pulisci tutto"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <AnimatePresence>
            {filteredDoneFiles.map(file => (
              <CompletedFileCard
                key={file.id}
                file={file}
                isNewest={file.id === doneFiles[0]?.id}
                onRemove={onRemove}
                onPreview={onPreview}
                onOpenFile={onOpenFile}
                onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
                currentFolder={file.outputDir ? sessionFolderMap?.get(normalizeSessionPath(file.outputDir)) : undefined}
              />
            ))}
            {completedSearch.trim() && filteredDoneFiles.length === 0 && (
              <motion.p
                key="no-results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm text-center py-6"
                style={{ color: 'var(--text-muted)' }}
              >
                Nessun risultato per "{completedSearch}"
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </>
  );
}
