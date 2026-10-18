import React from 'react';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { Link2, Link2Off } from 'lucide-react';

export const LinkButton = ({ editor, openRequest = 0 }: { editor: TiptapEditor; openRequest?: number }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [panelPos, setPanelPos] = React.useState({ top: 0, left: 0 });
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isActive = editor.isActive('link');

  const showPanel = () => {
    setUrl(editor.getAttributes('link').href ?? '');
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 6, left: rect.left });
    }
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openPanel = () => {
    if (isActive) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    showPanel();
  };

  // Ctrl+K and the context menu edit an existing link instead of removing it.
  const handledRequestRef = React.useRef(openRequest);
  React.useEffect(() => {
    if (openRequest === handledRequestRef.current) return;
    handledRequestRef.current = openRequest;
    showPanel();
    // showPanel reads the current selection when the request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
    };
  }, [isOpen]);

  const applyLink = () => {
    if (!url.trim()) return;
    const href = url.startsWith('http') ? url : `https://${url}`;
    const chain = editor.chain().focus();
    if (!editor.state.selection.empty) chain.setLink({ href }).run();
    // As in Docs, a caret inside a link edits the whole link, and a caret
    // elsewhere inserts the address as linked text. Links are inclusive, so
    // drop the stored link mark: the text typed next stays plain.
    else if (editor.isActive('link')) chain.extendMarkRange('link').setLink({ href }).run();
    else chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).unsetMark('link').run();
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openPanel}
        className={`editor-button${isActive ? ' is-active' : ''}`}
        title={isActive ? 'Rimuovi link' : 'Inserisci link (Ctrl+K)'}
      >
        {isActive ? <Link2Off className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
      </button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          className="link-panel"
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 9999 }}
        >
          <input
            ref={inputRef}
            type="url"
            placeholder="https://..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') applyLink();
              if (e.key === 'Escape') { e.stopPropagation(); setIsOpen(false); editor.commands.focus(); }
            }}
            className="link-input"
          />
          <button type="button" onClick={applyLink} className="link-apply-btn">Applica</button>
        </div>,
        document.body
      )}
    </>
  );
};
