import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { fadeUp } from '../motion';
import { AlertTriangle, ArrowRight, Trash2 } from 'lucide-react';
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
  // The dashboard keeps only the latest few; the archive holds the rest.
  limit?: number;
  onOpenArchive?: () => void;
}

export const CompletedSection = memo(function CompletedSection({ doneFiles, appState, onRemove, onPreview, onOpenFile, onClearAll, onRetryFailedRevisionBlocks, sessionFolderMap, limit, onOpenArchive }: CompletedSectionProps) {
  const shownFiles = limit ? doneFiles.slice(0, limit) : doneFiles;
  const hiddenCount = doneFiles.length - shownFiles.length;

  const warningCount = doneFiles.filter(f => f.completionStatus === 'completed_with_warnings' || (f.revisionFailedBlocks?.length ?? 0) > 0).length;
  const fullyCompletedCount = doneFiles.length - warningCount;

  return (
    <>
      {doneFiles.length > 0 && (
        <motion.div
          key="completed-section"
          {...fadeUp}
          className="dashboard-section"
        >
          <div className="dashboard-section-header">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="dashboard-section-title shrink-0">Recenti</h2>
              <span className="status-pill is-quiet shrink-0" title="Sbobine completate senza avvisi">{fullyCompletedCount}</span>
              {warningCount > 0 && (
                <span className="status-pill is-quiet is-warning shrink-0 whitespace-nowrap">
                  <AlertTriangle className="w-3 h-3" />
                  {warningCount} con avvisi
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {(appState === 'idle' || appState === 'processing') && (
                <button type="button" onClick={onClearAll} className="queue-text-button is-danger shrink-0" aria-label="Pulisci tutto">
                  <Trash2 className="w-3.5 h-3.5" />
                  Pulisci tutto
                </button>
              )}
              {onOpenArchive && (
                <button type="button" onClick={onOpenArchive} className="queue-text-button shrink-0">
                  {hiddenCount > 0 ? `Vedi tutte (${doneFiles.length}) nell'Archivio` : "Apri l'Archivio"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-hidden overflow-y-auto app-scroll is-chainable max-h-[390px] py-0.5">
            <div className="space-y-0.5">
            <AnimatePresence>
              {shownFiles.map(file => (
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
            </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
});
