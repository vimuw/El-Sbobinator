import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Info, X } from 'lucide-react';
import type { ArchiveSession } from '../../bridge';
import type { FileItem } from '../../appState';

export type AlreadyProcessedMatch =
  | { source: 'done'; existingFile: FileItem; incoming: FileItem }
  | { source: 'archive'; sessions: ArchiveSession[]; incoming: FileItem };

export type DuplicatePrompt =
  | { kind: 'in-queue'; filenames: string[] }
  | { kind: 'already-processed'; matches: AlreadyProcessedMatch[]; alsoInQueue?: string[] }
  | null;

interface DuplicateFileModalProps {
  prompt: DuplicatePrompt;
  onDismiss: () => void;
  onAddAgain: (matches: AlreadyProcessedMatch[]) => void;
}

export function DuplicateFileModal({ prompt, onDismiss, onAddAgain }: DuplicateFileModalProps) {
  return (
    <AnimatePresence>
      {prompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onDismiss}
            className="absolute inset-0"
            style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(10px)' }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="modal-card relative w-full max-w-md max-h-[86vh] overflow-hidden flex flex-col"
          >
            {prompt.kind === 'in-queue' ? (
              <InQueueVariant filenames={prompt.filenames} onDismiss={onDismiss} />
            ) : (
              <AlreadyProcessedVariant
                matches={prompt.matches}
                alsoInQueue={prompt.alsoInQueue}
                onDismiss={onDismiss}
                onAddAgain={() => onAddAgain(prompt.matches)}
              />
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function InQueueVariant({ filenames, onDismiss }: { filenames: string[]; onDismiss: () => void }) {
  const count = filenames.length;
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <Info className="w-5 h-5 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {count === 1 ? '1 file gia in coda' : `${count} file gia in coda`}
          </h2>
        </div>
        <button
          onClick={onDismiss}
          className="icon-button modal-icon-button"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Chiudi finestra"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {count === 1 ? (
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>{filenames[0]}</strong> e gia presente in coda e non e stato aggiunto di nuovo.
          </p>
        ) : (
          <>
            <p>{count} file sono gia presenti in coda e non sono stati aggiunti di nuovo:</p>
            <ul className="space-y-1 pl-1">
              {filenames.map(name => (
                <li key={name} className="truncate" style={{ color: 'var(--text-primary)' }}>- {name}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="px-5 py-4 flex gap-3 shrink-0" style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}>
        <button onClick={onDismiss} className="modal-action-button flex-1">
          Chiudi
        </button>
      </div>
    </>
  );
}

function AlreadyProcessedVariant({
  matches,
  alsoInQueue,
  onDismiss,
  onAddAgain,
}: {
  matches: AlreadyProcessedMatch[];
  alsoInQueue?: string[];
  onDismiss: () => void;
  onAddAgain: () => void;
}) {
  const count = matches.length;
  const hasDone = matches.some(match => match.source === 'done');
  const hasArchive = matches.some(match => match.source === 'archive');
  const archiveSessionCount = matches.reduce(
    (total, match) => total + (match.source === 'archive' ? match.sessions.length : 0),
    0,
  );
  const archiveMatchCount = matches.filter(match => match.source === 'archive').length;
  const isMixed = hasDone && hasArchive;
  const subtitle = hasArchive && !hasDone ? 'Sbobina gia completata in precedenza' : 'Sbobina gia completata';
  const locationPhrase = isMixed
    ? ' in questa sessione o in sessioni precedenti'
    : hasDone
      ? ' in questa sessione'
      : ' in sessioni precedenti';
  const singleArchiveMatch = count === 1 && matches[0].source === 'archive' ? matches[0] : null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <AlertCircle className="w-5 h-5 shrink-0" style={{ color: 'var(--warning-text)' }} />
          <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {subtitle}
          </h2>
        </div>
        <button
          onClick={onDismiss}
          className="icon-button modal-icon-button"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Chiudi finestra"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {count === 1 ? (
          <>
            <p>
              <strong style={{ color: 'var(--text-primary)' }}>{matches[0].incoming.name}</strong> risulta gia{' '}
              {singleArchiveMatch
                ? singleArchiveMatch.sessions.length === 1
                  ? 'elaborato in una sessione precedente'
                  : `elaborato in ${singleArchiveMatch.sessions.length} sessioni precedenti`
                : 'elaborato in questa sessione'}.
            </p>
            <p>Puoi tenere la versione gia pronta oppure aggiungere il file di nuovo per rielaborarlo da zero.</p>
          </>
        ) : (
          <>
            <p>
              {count} file risultano gia elaborati{locationPhrase}.
              Puoi tenerli oppure rielaborarli da zero.
            </p>
            {archiveSessionCount > archiveMatchCount && (
              <p>Ho trovato {archiveSessionCount} sessioni archiviate collegate a questi file.</p>
            )}
            <ul className="space-y-1 pl-1">
              {matches.map(match => (
                <li key={match.incoming.id} className="truncate" style={{ color: 'var(--text-primary)' }}>- {match.incoming.name}</li>
              ))}
            </ul>
          </>
        )}
        {alsoInQueue && alsoInQueue.length > 0 && (
          <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              {alsoInQueue.length === 1
                ? <><strong style={{ color: 'var(--text-secondary)' }}>{alsoInQueue[0]}</strong> era gia in coda e non e stato aggiunto di nuovo.</>
                : <>{alsoInQueue.length} file erano gia in coda e non sono stati aggiunti di nuovo:</>}
            </p>
            {alsoInQueue.length > 1 && (
              <ul className="space-y-1 pl-1 mt-1">
                {alsoInQueue.map(name => (
                  <li key={name} className="truncate" style={{ color: 'var(--text-muted)' }}>- {name}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-4 flex gap-3 shrink-0" style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}>
        <button onClick={onDismiss} className="modal-action-button flex-1">
          Tieni la versione pronta
        </button>
        <button onClick={onAddAgain} className="modal-action-button is-danger flex-1">
          Rigenera da zero
        </button>
      </div>
    </>
  );
}
