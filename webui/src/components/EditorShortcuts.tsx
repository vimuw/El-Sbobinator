import { useEffect, useId, useRef, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

const editorShortcutGroups = [
  { id: 'edit', title: 'Modifica', shortcuts: [
    ['Ctrl+Z', 'Annulla'],
    ['Ctrl+Y / Ctrl+Shift+Z', 'Ripeti'],
    ['Ctrl+A', 'Seleziona tutto'],
    ['Ctrl+C / Ctrl+X', 'Copia / Taglia la selezione'],
    ['Ctrl+V', 'Incolla'],
    ['Ctrl+Shift+V', 'Incolla senza formattazione'],
    ['Shift+Invio', 'Vai a capo nello stesso paragrafo'],
  ] },
  { id: 'format', title: 'Formattazione', shortcuts: [
    ['Ctrl+B', 'Grassetto'],
    ['Ctrl+I', 'Corsivo'],
    ['Ctrl+U', 'Sottolineato'],
    ['Ctrl+Shift+S', 'Barrato'],
    ['Ctrl+.', 'Apice'],
    ['Ctrl+,', 'Pedice'],
    ['Ctrl+Alt+1…5', 'Titolo di livello 1…5'],
    ['Ctrl+Shift+7', 'Elenco numerato'],
    ['Ctrl+Shift+8', 'Elenco puntato'],
    ['Ctrl+Shift+B', 'Citazione'],
    ['Ctrl+Shift+L/E/R/J', 'Allinea a sinistra / al centro / a destra / giustifica'],
  ] },
  { id: 'document', title: 'Ricerca e documento', shortcuts: [
    ['Ctrl+F', 'Trova'],
    ['Ctrl+H', 'Trova e sostituisci'],
    ['Ctrl+M', 'Inserisci formula'],
    ['Ctrl+Alt+O', 'Mostra / Nascondi indice'],
    ['Ctrl++ / Ctrl+−', 'Aumenta / Riduci zoom'],
    ['Ctrl+0', 'Ripristina zoom al 100%'],
  ] },
] as const;

const audioShortcuts = [
  ['F4', 'Pausa / Riprendi, anche mentre scrivi nell’editor'],
  ['Spazio', 'Pausa / Riprendi'],
  ['← / →', 'Indietro / Avanti di 10 secondi'],
  ['↑ / ↓', 'Aumenta / Riduci volume del 5%'],
] as const;

function ShortcutList({ shortcuts }: { shortcuts: readonly (readonly [string, string])[] }) {
  return <dl className="editor-shortcuts-list">
    {shortcuts.map(([keys, description]) => <div key={keys}>
      <dt><kbd>{keys}</kbd></dt>
      <dd>{description}</dd>
    </div>)}
  </dl>;
}

export function EditorShortcuts({ audioAvailable }: { audioAvailable: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const panelId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen) return;
    dialog.showModal();
    dialog.scrollTop = 0;
    return () => { if (dialog.open) dialog.close(); };
  }, [isOpen]);

  return <>
    <button type="button" className={`icon-button${isOpen ? ' icon-button--active' : ''}`}
      title="Scorciatoie da tastiera" aria-label="Scorciatoie da tastiera"
      aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={panelId}
      onClick={() => setIsOpen(true)}>
      <Keyboard className="w-4 h-4" />
    </button>
    <dialog ref={dialogRef} id={panelId} className="editor-shortcuts-dialog" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); setIsOpen(false); }}
      onClose={() => setIsOpen(false)}
      onKeyDown={event => {
        event.stopPropagation();
        // This reference panel has one control. Keep Tab on it rather than
        // allowing the browser to move focus into its own window chrome.
        if (event.key === 'Tab') {
          event.preventDefault();
          event.currentTarget.querySelector('button')?.focus();
        }
      }}
      onClick={event => { if (event.target === event.currentTarget) setIsOpen(false); }}>
      <div>
        <div className="editor-shortcuts-header">
          <h2 id={titleId}>Scorciatoie da tastiera</h2>
          <button type="button" className="icon-button modal-icon-button" aria-label="Chiudi scorciatoie" onClick={() => setIsOpen(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="editor-shortcuts-body">
          <section aria-label="Audio" className="editor-shortcuts-audio">
            <h3>Audio</h3>
            {!audioAvailable && <p>Collega un file audio per usare questi comandi.</p>}
            <ShortcutList shortcuts={audioShortcuts} />
            <p>Spazio e frecce controllano l’audio solo quando il focus è fuori dall’editor e dagli altri controlli. F4 funziona anche nell’editor, ma non nei campi di inserimento.</p>
          </section>
          <section aria-label="Editor">
            <h3>Editor</h3>
            <p>Per modificare il testo, porta il cursore nell’editor.</p>
            <div className="editor-shortcuts-groups">
              {editorShortcutGroups.map(group => <div key={group.id} className={`editor-shortcuts-group editor-shortcuts-group--${group.id}`}>
                <h4>{group.title}</h4>
                <ShortcutList shortcuts={group.shortcuts} />
              </div>)}
            </div>
          </section>
          <p className="editor-shortcuts-footer">Premi Esc per chiudere questo pannello.</p>
        </div>
      </div>
    </dialog>
  </>;
}
