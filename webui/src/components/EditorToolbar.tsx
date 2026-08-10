import React, { useRef } from 'react';
import { type Editor as TiptapEditor } from '@tiptap/core';
import {
  Bold, Italic, List, ListOrdered, Minus, Plus, Quote, Redo,
  RemoveFormatting, Search, Strikethrough,
  Underline as UnderlineIcon, Undo,
} from 'lucide-react';
import {
  ColorPickerButton, HighlightPickerButton, FontFamilySelect,
  FontSizeSelect, HeadingSelect, LinkButton, InsertDropdownButton, AlignDropdownButton
} from './EditorToolbarControls';

const menuBarStateKey = (editor: TiptapEditor): string => [
  editor.isActive('bold'),
  editor.isActive('italic'),
  editor.isActive('underline'),
  editor.isActive('strike'),
  editor.isActive('highlight'),
  editor.isActive('subscript'),
  editor.isActive('superscript'),
  editor.isActive('link'),
  editor.isActive('heading', { level: 1 }),
  editor.isActive('heading', { level: 2 }),
  editor.isActive('heading', { level: 3 }),
  editor.isActive('heading', { level: 4 }),
  editor.isActive('heading', { level: 5 }),
  editor.isActive('bulletList'),
  editor.isActive('orderedList'),
  editor.isActive('blockquote'),
  editor.isActive({ textAlign: 'center' }),
  editor.isActive({ textAlign: 'right' }),
  editor.isActive({ textAlign: 'justify' }),
  editor.can().undo(),
  editor.can().redo(),
  editor.getAttributes('highlight').color ?? '',
  editor.getAttributes('textStyle').color ?? '',
  editor.getAttributes('textStyle').fontFamily ?? '',
  editor.getAttributes('textStyle').fontSize ?? '',
].join('|');

export const MenuBar = ({
  editor,
  onOpenImagePicker,
  showFindReplace,
  onToggleFindReplace,
  zoomLevel,
  onZoomChange,
}: {
  editor: TiptapEditor | null;
  onOpenImagePicker: () => void;
  showFindReplace: boolean;
  onToggleFindReplace: () => void;
  zoomLevel?: number;
  onZoomChange?: (level: number) => void;
}) => {
  const [, forceUpdate] = React.useState({});
  const prevMenuKeyRef = useRef('');

  React.useEffect(() => {
    if (!editor) return;
    const handleTransaction = () => {
      const key = menuBarStateKey(editor);
      if (key !== prevMenuKeyRef.current) {
        prevMenuKeyRef.current = key;
        forceUpdate({});
      }
    };
    editor.on('transaction', handleTransaction);
    return () => { editor.off('transaction', handleTransaction); };
  }, [editor]);

  if (!editor) return null;
  const btn = (active: boolean) => `editor-button${active ? ' is-active' : ''}`;

  return (
    <div className="editor-toolbar">
      <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className="editor-button" title="Annulla (Ctrl+Z)">
        <Undo className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className="editor-button" title="Ripeti (Ctrl+Y)">
        <Redo className="h-4 w-4" />
      </button>
      <div className="editor-separator" />
      <HeadingSelect editor={editor} />
      <FontFamilySelect editor={editor} />
      <FontSizeSelect editor={editor} />
      <div className="editor-separator" />
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))} title="Grassetto (Ctrl+B)">
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))} title="Corsivo (Ctrl+I)">
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive('underline'))} title="Sottolineato (Ctrl+U)">
        <UnderlineIcon className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive('strike'))} title="Barrato">
        <Strikethrough className="h-4 w-4" />
      </button>
      <ColorPickerButton editor={editor} />
      <HighlightPickerButton editor={editor} />
      <button
        type="button"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        className="editor-button"
        title="Rimuovi formattazione"
      >
        <RemoveFormatting className="h-4 w-4" />
      </button>
      <div className="editor-separator" />
      <InsertDropdownButton editor={editor} onOpenImagePicker={onOpenImagePicker} />
      <LinkButton editor={editor} />
      <div className="editor-separator" />
      <AlignDropdownButton editor={editor} />
      <div className="editor-separator" />
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))} title="Elenco puntato">
        <List className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))} title="Elenco numerato">
        <ListOrdered className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))} title="Citazione">
        <Quote className="h-4 w-4" />
      </button>
      <div className="editor-separator" />
      <button
        type="button"
        onClick={onToggleFindReplace}
        className={btn(showFindReplace)}
        title="Trova e sostituisci (Ctrl+H)"
      >
        <Search className="h-4 w-4" />
      </button>

      {onZoomChange !== undefined && zoomLevel !== undefined && (
        <>
          <div className="editor-separator" />
          <div className="editor-zoom-control">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(50, zoomLevel - 10))}
              className="editor-button"
              title="Riduci zoom (Ctrl+-)"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="editor-zoom-display"
              title="Reimposta zoom 100% (Ctrl+0)"
            >
              {zoomLevel}%
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(200, zoomLevel + 10))}
              className="editor-button"
              title="Aumenta zoom (Ctrl+=)"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};
