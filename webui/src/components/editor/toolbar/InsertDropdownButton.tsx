import React from 'react';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { Calculator, ChevronDown, ImagePlus, Minus, Plus, Video } from 'lucide-react';

export const InsertMathButton = ({ editor }: { editor: TiptapEditor }) => {
  const handleInsert = () => {
    const latex = window.prompt('Inserisci formula LaTeX (es. E=mc^2, \\frac{a}{b}):', 'E=mc^2');
    if (latex && latex.trim()) {
      editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: latex.trim() } }).run();
    }
  };

  return (
    <button
      type="button"
      onClick={handleInsert}
      className="editor-button"
      title="Inserisci formula matematica (LaTeX)"
    >
      <Calculator className="h-4 w-4" />
    </button>
  );
};

export const InsertYoutubeButton = ({ editor }: { editor: TiptapEditor }) => {
  const handleInsert = () => {
    const url = window.prompt('Inserisci URL del video YouTube:');
    if (url && url.trim()) {
      (editor.chain().focus() as unknown as { setYoutubeVideo: (options: { src: string }) => { run: () => boolean } }).setYoutubeVideo({ src: url.trim() }).run();
    }
  };

  return (
    <button
      type="button"
      onClick={handleInsert}
      className="editor-button"
      title="Inserisci video YouTube"
    >
      <Video className="h-4 w-4" />
    </button>
  );
};

export const InsertDropdownButton = ({
  editor,
  onOpenImagePicker,
}: {
  editor: TiptapEditor;
  onOpenImagePicker: () => void;
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [panelPos, setPanelPos] = React.useState({ top: 0, left: 0 });
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const toggleOpen = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 6, left: rect.left });
    }
    setIsOpen(prev => !prev);
  };

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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`editor-button insert-dropdown-btn${isOpen ? ' is-active' : ''}`}
        title="Inserisci elemento"
      >
        <Plus className="h-4 w-4" />
        <span className="text-xs font-medium ml-1">Inserisci</span>
        <ChevronDown style={{ width: 10, height: 10, opacity: 0.6, marginLeft: 2 }} />
      </button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          className="editor-dropdown-panel"
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 9999 }}
        >
          <button
            type="button"
            className="editor-dropdown-item"
            onClick={() => { setIsOpen(false); onOpenImagePicker(); }}
          >
            <ImagePlus className="h-4 w-4" />
            <span>Immagine</span>
          </button>
          <button
            type="button"
            className="editor-dropdown-item"
            onClick={() => {
              setIsOpen(false);
              const url = window.prompt('Inserisci URL del video YouTube:');
              if (url && url.trim()) {
                (editor.chain().focus() as unknown as { setYoutubeVideo: (options: { src: string }) => { run: () => boolean } }).setYoutubeVideo({ src: url.trim() }).run();
              }
            }}
          >
            <Video className="h-4 w-4" />
            <span>Video YouTube</span>
          </button>
          <button
            type="button"
            className="editor-dropdown-item"
            onClick={() => {
              setIsOpen(false);
              const latex = window.prompt('Inserisci formula LaTeX:', 'E=mc^2');
              if (latex && latex.trim()) {
                editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: latex.trim() } }).run();
              }
            }}
          >
            <Calculator className="h-4 w-4" />
            <span>Formula Matematica (LaTeX)</span>
          </button>
          <button
            type="button"
            className="editor-dropdown-item"
            onClick={() => {
              setIsOpen(false);
              editor.chain().focus().setHorizontalRule().run();
            }}
          >
            <Minus className="h-4 w-4" />
            <span>Linea divisoria</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
};
