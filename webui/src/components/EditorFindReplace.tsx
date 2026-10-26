import React, { useState, useCallback, useEffect, useRef } from 'react';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { ChevronDown, MoreVertical, X } from 'lucide-react';
import { getSearchMatches, type SearchMatch } from '../editorExtensions';
import { shortcutLabel } from '../keyboardLabels';

export const FindReplacePanel = ({
  editor,
  onClose,
  initialMode,
  focusTrigger,
  initialFindText,
}: {
  editor: TiptapEditor;
  onClose: () => void;
  initialMode: 'find' | 'replace';
  focusTrigger?: number;
  initialFindText?: string;
}) => {
  const [expanded, setExpanded] = useState(initialMode === 'replace');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [matchCase, setMatchCase] = useState(false);
  const matchesRef = useRef<SearchMatch[]>([]);
  const currentMatchRef = useRef(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const pendingInitialFindRef = useRef(initialFindText);

  const updateSearch = useCallback((text: string, curIdx = -1, caseFlag = matchCase) => {
    editor.commands.setSearchTerm(text, curIdx, caseFlag);
    const matches = getSearchMatches(editor);
    matchesRef.current = matches;
    setMatchCount(matches.length);
    return matches;
  }, [editor, matchCase]);

  useEffect(() => {
    findInputRef.current?.focus({ preventScroll: true });
    const initialText = pendingInitialFindRef.current;
    let frame = 0;
    let scrollFrame = 0;
    if (initialText) {
      setFindText(initialText);
      // useEditor can replace a StrictMode instance before this frame. The
      // replacement reruns this effect, so the query waits for a live editor.
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        pendingInitialFindRef.current = undefined;
        editor.commands.setSearchTerm(initialText, 0, false);
        const matches = getSearchMatches(editor);
        matchesRef.current = matches;
        setMatchCount(matches.length);
        if (matches.length > 0) {
          currentMatchRef.current = 1;
          setCurrentMatch(1);
          scrollFrame = requestAnimationFrame(() => {
            if (editor.isDestroyed) return;
            const activeEl = editor.view.dom.querySelector('.search-highlight-active');
            if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
      });
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      if (editor && !editor.isDestroyed) {
        try {
          editor.commands.setSearchTerm('', -1, false);
        } catch (_) {}
      }
    };
  }, [editor]);

  useEffect(() => {
    if (focusTrigger !== undefined && focusTrigger > 0) {
      findInputRef.current?.focus({ preventScroll: true });
    }
  }, [focusTrigger]);

  useEffect(() => {
    if (initialMode === 'replace') setExpanded(true);
  }, [initialMode]);

  const scrollToMatch = useCallback((matches: SearchMatch[], idx: number, text = findText, caseFlag = matchCase) => {
    if (!matches.length || !editor) return;
    currentMatchRef.current = idx + 1;
    setCurrentMatch(idx + 1);
    editor.commands.setSearchTerm(text, idx, caseFlag);
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const activeEl = editor.view.dom.querySelector('.search-highlight-active');
      if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      findInputRef.current?.focus({ preventScroll: true });
    });
  }, [editor, findText, matchCase]);

  const handleNext = useCallback(() => {
    const matches = matchesRef.current.length ? matchesRef.current : getSearchMatches(editor);
    if (!matches.length) return;
    const next = currentMatchRef.current >= matches.length ? 0 : currentMatchRef.current;
    scrollToMatch(matches, next);
  }, [editor, scrollToMatch]);

  const handlePrev = useCallback(() => {
    const matches = matchesRef.current.length ? matchesRef.current : getSearchMatches(editor);
    if (!matches.length) return;
    const prev = currentMatchRef.current <= 1 ? matches.length - 1 : currentMatchRef.current - 2;
    scrollToMatch(matches, prev);
  }, [editor, scrollToMatch]);

  const handleReplace = () => {
    if (!editor || !findText) return;
    const matches = getSearchMatches(editor);
    if (!matches.length) return;
    // Successivo and Enter only highlight the active match, so it is the
    // replacement target; a hand selection of a match is the fallback.
    const { from: selFrom, to: selTo } = editor.state.selection;
    const target = matches[currentMatchRef.current - 1]
      ?? matches.find(m => m.from === selFrom && m.to === selTo);
    if (!target) {
      handleNext();
      return;
    }
    const { from, to } = target;
    const tr = editor.state.tr;
    if (replaceText) {
      const marks = tr.doc.resolve(from).nodeAfter?.marks;
      editor.view.dispatch(tr.replaceWith(from, to, editor.schema.text(replaceText, marks)));
    } else {
      editor.view.dispatch(tr.delete(from, to));
    }
    const newMatches = updateSearch(findText, -1);
    if (!newMatches.length) {
      currentMatchRef.current = 0;
      setCurrentMatch(0);
      return;
    }
    // Advance past the inserted text, so a replacement containing the query
    // is not matched again.
    const after = from + replaceText.length;
    const nextIdx = newMatches.findIndex(m => m.from >= after);
    scrollToMatch(newMatches, nextIdx === -1 ? 0 : nextIdx);
  };

  const handleReplaceAll = () => {
    if (!editor || !findText) return;
    const matches = getSearchMatches(editor);
    if (!matches.length) return;
    const sortedMatches = [...matches].sort((a, b) => b.from - a.from);
    const tr = editor.state.tr;
    for (const m of sortedMatches) {
      if (replaceText) {
        // Each replacement inherits its first matched character, including
        // links and explicit styles at the start of a formatting boundary.
        const marks = tr.doc.resolve(m.from).nodeAfter?.marks;
        tr.replaceWith(m.from, m.to, editor.schema.text(replaceText, marks));
      } else {
        tr.delete(m.from, m.to);
      }
    }
    editor.view.dispatch(tr);
    matchesRef.current = [];
    currentMatchRef.current = 0;
    setMatchCount(0);
    setCurrentMatch(0);
    editor.commands.setSearchTerm('', -1, false);
    requestAnimationFrame(() => findInputRef.current?.focus({ preventScroll: true }));
  };

  const handleMatchCaseChange = (checked: boolean) => {
    setMatchCase(checked);
    currentMatchRef.current = 0;
    setCurrentMatch(0);
    updateSearch(findText, -1, checked);
  };

  const findInputChange = (val: string) => {
    pendingInitialFindRef.current = undefined;
    setFindText(val);
    currentMatchRef.current = 0;
    setCurrentMatch(0);
    updateSearch(val, -1);
  };

  // Escape closes only the search: the full-page editor closes itself on a window-level Escape.
  const closeFromKeyboard = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    onClose();
    editor.commands.focus();
  };

  if (!expanded) {
    return (
      <div className="find-bar-float">
        <input
          ref={findInputRef}
          type="text"
          placeholder="Trova nel documento..."
          value={findText}
          onChange={e => findInputChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? handlePrev() : handleNext(); }
            if (e.key === 'Escape') closeFromKeyboard(e);
          }}
          className="find-bar-input"
        />
        <span className="find-bar-count">
          {findText ? (matchCount > 0 ? `${currentMatch} di ${matchCount}` : 'Nessun risultato') : ''}
        </span>
        <button type="button" onClick={handlePrev} className="find-bar-btn" title={shortcutLabel('Precedente (Shift+Invio)')} disabled={matchCount === 0}>
          <ChevronDown size={15} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button type="button" onClick={handleNext} className="find-bar-btn" title="Successivo (Invio)" disabled={matchCount === 0}>
          <ChevronDown size={15} />
        </button>
        <button type="button" onClick={() => setExpanded(true)} className="find-bar-btn" title="Trova e sostituisci">
          <MoreVertical size={15} />
        </button>
        <button type="button" onClick={onClose} className="find-bar-btn" title="Chiudi (Esc)">
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="find-replace-dialog">
      <div className="find-replace-dialog-header">
        <span className="find-replace-dialog-title">Trova e sostituisci</span>
        <button type="button" onClick={onClose} className="find-bar-btn" title="Chiudi (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="find-replace-dialog-body">
        <div className="find-replace-dialog-field">
          <label className="find-replace-dialog-label">Trova</label>
          <input
            ref={findInputRef}
            type="text"
            value={findText}
            onChange={e => findInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleNext(); }
              if (e.key === 'Escape') closeFromKeyboard(e);
            }}
            className="find-replace-dialog-input"
          />
          {findText && (
            <span className="find-replace-dialog-count">
              {matchCount > 0 ? `${currentMatch} di ${matchCount}` : 'Nessun risultato'}
            </span>
          )}
        </div>
        <div className="find-replace-dialog-field">
          <input
            type="text"
            placeholder="Sostituisci con..."
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleReplace(); }
              if (e.key === 'Escape') closeFromKeyboard(e);
            }}
            className="find-replace-dialog-input"
          />
        </div>
        <label className="find-replace-dialog-check">
          <input type="checkbox" checked={matchCase} onChange={e => handleMatchCaseChange(e.target.checked)} />
          <span>Maiuscole/minuscole</span>
        </label>
        <div className="find-replace-dialog-actions">
          <button type="button" onClick={handleReplace} disabled={matchCount === 0} className="find-replace-dialog-btn">
            Sostituisci
          </button>
          <button type="button" onClick={handleReplaceAll} disabled={matchCount === 0} className="find-replace-dialog-btn">
            Sostituisci tutto
          </button>
          <button type="button" onClick={handlePrev} disabled={matchCount === 0} className="find-replace-dialog-btn">
            Precedente
          </button>
          <button type="button" onClick={handleNext} disabled={matchCount === 0} className="find-replace-dialog-btn find-replace-dialog-btn-primary">
            Successivo
          </button>
        </div>
      </div>
    </div>
  );
};
