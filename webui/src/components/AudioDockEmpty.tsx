import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Headphones, Loader2, Plus } from 'lucide-react';
import { useDockFold } from '../hooks/useDockFold';

interface AudioDockEmptyProps {
  /** `missing`: the sbobina has audio this device cannot play yet; `none`: no audio linked. */
  state: 'missing' | 'none';
  /** Web: the lecture is picked each time instead of a copy kept in the sbobina. */
  audioPicked: boolean;
  onRelink: () => Promise<boolean | undefined>;
  /** Asks to drop the missing copy; the editor confirms it. */
  onRemove?: () => void;
  isRemoving?: boolean;
}

/**
 * The audio dock without a player: one row in place of the player, folding into the same corner
 * button, so a sbobina without audio keeps the text as clear as one with a folded player.
 */
export function AudioDockEmpty({ state, audioPicked, onRelink, onRemove, isRemoving = false }: AudioDockEmptyProps) {
  const [isRelinking, setIsRelinking] = useState(false);
  const [relinkSuccess, setRelinkSuccess] = useState(false);
  const relinkTimerRef = useRef<number | null>(null);
  const { fold, setCollapsed, collapseBtnRef, pillProps, barTouchProps, foldClassName } = useDockFold();
  useEffect(() => () => {
    if (relinkTimerRef.current) window.clearTimeout(relinkTimerRef.current);
  }, []);

  const missing = state === 'missing';
  const title = missing ? (audioPicked ? 'Audio non salvato' : 'Audio non trovato') : 'Nessun audio collegato';
  const hint = missing
    ? (audioPicked
      ? 'Scegli il file della lezione per riascoltarla mentre rileggi.'
      : 'Seleziona di nuovo il file per conservarne una copia nella sbobina.')
    : (audioPicked
      ? 'Scegli il file della lezione per ascoltarlo mentre rileggi.'
      : 'Aggiungi un file audio: una copia verrà conservata nella sbobina.');
  const actionLabel = audioPicked ? 'Scegli il file audio' : missing ? 'Ricollega audio' : 'Aggiungi audio';

  const handleRelink = async () => {
    if (isRelinking) return;
    setIsRelinking(true);
    try {
      const ok = await onRelink();
      if (ok) {
        if (relinkTimerRef.current) window.clearTimeout(relinkTimerRef.current);
        setRelinkSuccess(true);
        relinkTimerRef.current = window.setTimeout(() => setRelinkSuccess(false), 3000);
      }
    } finally {
      setIsRelinking(false);
    }
  };

  if (fold.collapsed) {
    return (
      <div className={`${foldClassName} audio-dock-empty`}>
        <button
          {...pillProps}
          type="button"
          className="player-pill"
          aria-label={`Mostra la barra audio (${title.toLowerCase()})`}
          title="Mostra la barra audio (trascinala per spostarla)"
        >
          <Headphones className="h-4 w-4" />
          <span className="audio-dock-pill-badge" aria-hidden="true"><Plus className="h-2.5 w-2.5" strokeWidth={3} /></span>
        </button>
      </div>
    );
  }

  const foldTab = (
    <button
      ref={collapseBtnRef}
      type="button"
      className={`player-fold-tab is-${fold.side}`}
      aria-label="Riduci la barra audio a icona"
      title="Riduci a icona (anche con uno swipe)"
      onClick={() => setCollapsed(true)}
    >
      {fold.side === 'left' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );

  return (
    <div className={`${foldClassName} audio-dock-empty flex items-center gap-2.5 py-1.5`} {...barTouchProps}>
      {fold.side === 'left' && foldTab}
      <span className="audio-dock-empty-icon" aria-hidden="true">
        <Headphones className="h-4 w-4" />
      </span>
      {/* The hint follows the title on the same row and gives way first; phones keep it in the tooltip. */}
      <p className="min-w-0 truncate text-sm" title={hint}>
        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <span className="audio-dock-empty-hint" style={{ color: 'var(--text-muted)' }}><span aria-hidden="true"> · </span>{hint}</span>
      </p>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={isRemoving}
          className="app-button-secondary is-settings-action audio-dock-empty-action"
          title="Rimuovi audio dalla sbobina"
          aria-label="Rimuovi audio dalla sbobina"
        >
          {isRemoving ? 'Rimozione...' : 'Rimuovi audio'}
        </button>
      )}
      <button
        type="button"
        onClick={() => void handleRelink()}
        disabled={isRelinking}
        title={hint}
        className={`${missing ? 'app-button-secondary is-settings-action' : 'settings-pill-button'} audio-dock-empty-action`}
        style={relinkSuccess ? { borderColor: 'var(--success-ring)', color: 'var(--success-text)' } : undefined}
      >
        {relinkSuccess ? (
          <><Check className="w-3.5 h-3.5" /> {audioPicked ? 'Audio pronto' : 'Ricollegato'}</>
        ) : isRelinking ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Selezione...</span></>
        ) : (
          <>{!missing && <Plus className="w-3.5 h-3.5" />}<span>{actionLabel}</span></>
        )}
      </button>
      {fold.side === 'right' && foldTab}
    </div>
  );
}
