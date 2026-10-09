import React, { useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { Check, X } from 'lucide-react';

/** Shared, transient source editor. Only confirmed, valid LaTeX reaches the document. */
export function MathEditorField({ initialLatex = '', displayMode = false, onCommit, onCancel }: {
  initialLatex?: string;
  displayMode?: boolean;
  onCommit: (latex: string, returnFocus: boolean) => void;
  onCancel: (returnFocus: boolean) => void;
}) {
  const [latex, setLatex] = useState(initialLatex);
  const finished = useRef(false);
  const preview = useMemo(() => {
    if (!latex.trim()) return null;
    try { return katex.renderToString(latex.trim(), { displayMode, throwOnError: true, trust: false }); }
    catch { return null; }
  }, [latex, displayMode]);
  const invalid = Boolean(latex.trim() && !preview);
  const finish = (save: boolean, returnFocus: boolean) => {
    if (finished.current) return;
    if (save && !preview) return;
    finished.current = true;
    if (save) onCommit(latex.trim(), returnFocus);
    else onCancel(returnFocus);
  };

  return <span className="math-editor-field" contentEditable={false} role="group" aria-label="Modifica formula"
    onBlur={event => {
      if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) return;
      finish(Boolean(preview), false);
    }}>
    {preview && <span className="math-editor-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: preview }} />}
    <span className={`math-editor-source${invalid ? ' is-invalid' : ''}`}>
      <input autoFocus type="text" aria-label="Formula LaTeX" aria-invalid={invalid}
        value={latex} placeholder="Scrivi una formula…" autoComplete="off" spellCheck={false}
        style={{ width: `${Math.max(18, Math.min(42, latex.length + 2))}ch` }}
        onChange={event => setLatex(event.target.value)}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); finish(true, true); }
          if (event.key === 'Escape') { event.preventDefault(); finish(false, true); }
        }} />
      <button type="button" aria-label="Conferma formula" title="Conferma (Invio)" disabled={!preview}
        onMouseDown={event => event.preventDefault()} onClick={() => finish(true, true)}><Check size={14} /></button>
      <button type="button" aria-label="Annulla formula" title="Annulla (Esc)"
        onMouseDown={event => event.preventDefault()} onClick={() => finish(false, true)}><X size={14} /></button>
    </span>
    {invalid && <span className="math-editor-error" role="status">Controlla la sintassi LaTeX.</span>}
  </span>;
}
