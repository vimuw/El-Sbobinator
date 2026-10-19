import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { fade, fadeUp } from '../motion';
import { AlertTriangle, CheckCircle, Search, Trash2, X } from 'lucide-react';
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

export const CompletedSection = memo(function CompletedSection({ doneFiles, appState, onRemove, onPreview, onOpenFile, onClearAll, onRetryFailedRevisionBlocks, sessionFolderMap }: CompletedSectionProps) {
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
          {...fadeUp}
          className="premium-panel p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <h2 className="section-title flex items-center gap-2">
                <CheckCircle className="w-4 h-4" style={{ color: 'var(--success-text)' }} />
                Sbobine completate
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="status-pill is-quiet shrink-0" title="Sbobine completate senza avvisi">{fullyCompletedCount}</span>
                {warningCount > 0 && (
                  <span className="status-pill is-quiet is-warning shrink-0 whitespace-nowrap">
                    <AlertTriangle className="w-3 h-3" />
                    {warningCount} con avvisi
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {doneFiles.length >= 5 && (
                <div className="search-pill-wrap w-48 sm:w-64">
                  <Search className="search-pill-icon w-3.5 h-3.5" />
                  <input
                    type="text"
                    value={completedSearch}
                    onChange={e => setCompletedSearch(e.target.value)}
                    placeholder="Cerca..."
                    className="search-pill-input"
                  />
                  {completedSearch.trim() && (
                    <button
                      type="button"
                      onClick={() => setCompletedSearch('')}
                      className="search-pill-clear"
                      aria-label="Cancella ricerca"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
              {(appState === 'idle' || appState === 'processing') && (
                <button type="button" onClick={onClearAll} className="queue-text-button is-danger shrink-0" aria-label="Pulisci tutto">
                  <Trash2 className="w-3.5 h-3.5" />
                  Pulisci tutto
                </button>
              )}
            </div>
          </div>

          <div
            className="overflow-x-hidden overflow-y-auto app-scroll is-chainable max-h-[390px] px-1.5 py-1"
          >
            <div className="space-y-3">
              <AnimatePresence>
                {filteredDoneFiles.map(file => (
                  <CompletedFileCard
                    key={file.id}
                    file={file}
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
                    {...fade}
                    className="text-sm text-center py-6"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Nessun risultato per "{completedSearch}"
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
});
