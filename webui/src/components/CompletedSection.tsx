import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { fadeUp } from '../motion';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { FileItem } from '../appState';
import type { ArchiveFolder } from '../bridge';
import { CompletedFileCard } from './QueueFileCard';
import { normalizeSessionPath } from '../utils';

interface CompletedSectionProps {
  // Already capped to the latest few by the reducer; the archive holds the rest.
  doneFiles: FileItem[];
  onRemove: (id: string) => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string) => void;
  onOpenFile: (path: string) => void;
  onRetryFailedRevisionBlocks?: (sessionDir: string, fileId?: string) => Promise<void>;
  sessionFolderMap?: Map<string, ArchiveFolder>;
  onOpenArchive?: () => void;
}

export const CompletedSection = memo(function CompletedSection({ doneFiles, onRemove, onPreview, onOpenFile, onRetryFailedRevisionBlocks, sessionFolderMap, onOpenArchive }: CompletedSectionProps) {
  const warningCount = doneFiles.filter(f => f.completionStatus === 'completed_with_warnings' || (f.revisionFailedBlocks?.length ?? 0) > 0).length;

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
              {warningCount > 0 && (
                <span className="status-pill is-quiet is-warning shrink-0 whitespace-nowrap">
                  <AlertTriangle className="w-3 h-3" />
                  {warningCount} con avvisi
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {onOpenArchive && (
                <button type="button" onClick={onOpenArchive} className="queue-text-button shrink-0">
                  Apri l'Archivio
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-hidden overflow-y-auto app-scroll is-chainable max-h-[390px] p-1">
            <div className="space-y-2">
            <AnimatePresence>
              {doneFiles.map(file => (
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
