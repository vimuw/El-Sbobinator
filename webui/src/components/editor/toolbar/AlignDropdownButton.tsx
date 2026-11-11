import React from 'react';
import { createPortal } from 'react-dom';
import { usePopoverPresence } from '../../../hooks/usePopoverPresence';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ChevronDown } from 'lucide-react';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { useAnchoredPanel } from './anchoredPanel';

export const AlignDropdownButton = ({ editor }: { editor: TiptapEditor }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const presence = usePopoverPresence(isOpen);
  const { panelPos, placeUnder } = useAnchoredPanel(isOpen, panelRef);

  const isCenter = editor.isActive({ textAlign: 'center' });
  const isRight = editor.isActive({ textAlign: 'right' });
  const isJustify = editor.isActive({ textAlign: 'justify' });

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) placeUnder(buttonRef.current);
    setIsOpen(prev => !prev);
  };

  useEscapeToClose(isOpen, () => setIsOpen(false));

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

  const CurrentIcon = isCenter ? AlignCenter : isRight ? AlignRight : isJustify ? AlignJustify : AlignLeft;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button align-dropdown-btn${isOpen ? ' is-active' : ''}`}
        title="Allineamento testo"
      >
        <CurrentIcon className="h-4 w-4" />
        <ChevronDown size={9} style={{ opacity: 0.6, marginLeft: 2 }} />
      </button>
      {presence.shown && createPortal(
        <div
          ref={panelRef}
          className={`kebab-panel editor-dropdown-panel${presence.closing ? ' popover-closing' : ''}`}
          inert={presence.closing}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 'var(--z-popover)' }}
        >
          <button
            type="button"
            className={`kebab-item editor-dropdown-item${!isCenter && !isRight && !isJustify ? ' is-active' : ''}`}
            onClick={() => { setIsOpen(false); editor.chain().focus().setTextAlign('left').run(); }}
          >
            <AlignLeft className="h-4 w-4" />
            <span>A sinistra</span>
          </button>
          <button
            type="button"
            className={`kebab-item editor-dropdown-item${isCenter ? ' is-active' : ''}`}
            onClick={() => { setIsOpen(false); editor.chain().focus().setTextAlign('center').run(); }}
          >
            <AlignCenter className="h-4 w-4" />
            <span>Al centro</span>
          </button>
          <button
            type="button"
            className={`kebab-item editor-dropdown-item${isRight ? ' is-active' : ''}`}
            onClick={() => { setIsOpen(false); editor.chain().focus().setTextAlign('right').run(); }}
          >
            <AlignRight className="h-4 w-4" />
            <span>A destra</span>
          </button>
          <button
            type="button"
            className={`kebab-item editor-dropdown-item${isJustify ? ' is-active' : ''}`}
            onClick={() => { setIsOpen(false); editor.chain().focus().setTextAlign('justify').run(); }}
          >
            <AlignJustify className="h-4 w-4" />
            <span>Giustificato</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
};
