import React from 'react';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { ChevronDown, Subscript, Superscript } from 'lucide-react';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { shortcutLabel } from '../../../keyboardLabels';
import { useAnchoredPanel } from './anchoredPanel';

// Apice and pedice share one button: side by side at 16 px their icons read as the same one.
// The button shows the active style, like the alignment one.
export const ScriptDropdownButton = ({ editor }: { editor: TiptapEditor }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const { panelPos, placeUnder } = useAnchoredPanel(isOpen, panelRef);

  const isSuperscript = editor.isActive('superscript');
  const isSubscript = editor.isActive('subscript');

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

  const CurrentIcon = isSubscript ? Subscript : Superscript;
  const items = [
    { label: 'Apice', shortcut: 'Ctrl+.', icon: Superscript, active: isSuperscript, toggle: () => editor.chain().focus().toggleSuperscript().run() },
    { label: 'Pedice', shortcut: 'Ctrl+,', icon: Subscript, active: isSubscript, toggle: () => editor.chain().focus().toggleSubscript().run() },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button align-dropdown-btn${isOpen || isSuperscript || isSubscript ? ' is-active' : ''}`}
        title="Apice e pedice"
        aria-label="Apice e pedice"
        aria-haspopup="true"
        aria-expanded={isOpen}
        data-script={isSuperscript ? 'superscript' : isSubscript ? 'subscript' : 'none'}
      >
        <CurrentIcon className="h-4 w-4" />
        <ChevronDown size={9} style={{ opacity: 0.6, marginLeft: 2 }} />
      </button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          role="group"
          aria-label="Apice e pedice"
          className="kebab-panel editor-dropdown-panel"
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 'var(--z-popover)' }}
        >
          {items.map(({ label, shortcut, icon: Icon, active, toggle }) => (
            <button
              key={label}
              type="button"
              className={`kebab-item editor-dropdown-item${active ? ' is-active' : ''}`}
              aria-label={shortcutLabel(`${label} (${shortcut})`)}
              aria-pressed={active}
              onClick={() => { setIsOpen(false); toggle(); }}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
              <kbd className="editor-context-menu-shortcut">{shortcutLabel(shortcut)}</kbd>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};
