import React from 'react';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { ChevronDown } from 'lucide-react';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { useAnchoredPanel } from './anchoredPanel';
import { COLOR_PALETTE } from './formatOptions';

export const ColorPickerButton = ({ editor }: { editor: TiptapEditor }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const { panelPos, placeUnder } = useAnchoredPanel(isOpen, panelRef);
  const currentColor: string | undefined = editor.getAttributes('textStyle').color
    ?? editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').documentStyle?.color;

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

  const applyColor = (color: string, close = true) => {
    editor.chain().focus().setColor(color).run();
    if (close) setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button color-picker-btn${isOpen ? ' is-active' : ''}`}
        title="Colore testo"
      >
        <span className="color-picker-label">
          <span style={{ fontWeight: 700, fontSize: 'var(--text-label)', lineHeight: 'var(--leading-none)', fontFamily: 'serif' }}>A</span>
          <span
            className="color-indicator"
            style={{ background: currentColor ?? 'var(--text-primary)', opacity: currentColor ? 1 : 0.55 }}
          />
        </span>
        <ChevronDown size={9} style={{ opacity: 0.55, flexShrink: 0 }} />
      </button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          className="color-picker-panel"
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 'var(--z-popover)' }}
        >
          {COLOR_PALETTE.map((row, ri) => (
            <div key={ri} className="color-row">
              {row.map(color => (
                <button
                  key={color}
                  type="button"
                  onPointerDown={e => { e.preventDefault(); applyColor(color); }}
                  className={`color-swatch${currentColor === color ? ' is-selected' : ''}`}
                  style={{ background: color }}
                  title={color}
                />
              ))}
            </div>
          ))}
          <div className="color-footer">
            <button
              type="button"
              onPointerDown={e => { e.preventDefault(); editor.chain().focus().clearDocumentColor().run(); setIsOpen(false); }}
              className="color-reset"
            >
              ✕ Rimuovi colore
            </button>
            <label className="color-custom" title="Colore personalizzato">
              <span className="color-custom-preview" style={{ background: currentColor || 'var(--text-muted)' }} />
              Personalizzato
              <input
                type="color"
                value={currentColor || '#888888'}
                onChange={e => applyColor(e.target.value, false)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
              />
            </label>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
