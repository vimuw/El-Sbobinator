import React, { useRef } from 'react';
import { type Editor as TiptapEditor } from '@tiptap/core';
import {
  Bold, Italic, List, ListOrdered, ListTree, Quote, Redo,
  RemoveFormatting, Search, Strikethrough, Superscript, Subscript,
  Type, Underline as UnderlineIcon, Undo,
} from 'lucide-react';
import {
  ColorPickerButton, HighlightPickerButton, FontFamilySelect,
  FontSizeSelect, HeadingSelect, LinkButton, AlignDropdownButton,
  InsertImageButton, InsertMathButton, InsertYoutubeButton,
  ZoomSelect,
} from './EditorToolbarControls';
import { editorIsBold } from '../editorBold';
import { shortcutLabel } from '../keyboardLabels';
import { usePhoneLayout } from '../hooks/usePhoneLayout';

const menuBarStateKey = (editor: TiptapEditor): string => [
  editorIsBold(editor),
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
  Boolean(editor.can?.()?.undo?.()),
  Boolean(editor.can?.()?.redo?.()),
  editor.getAttributes('highlight').color ?? '',
  editor.getAttributes('textStyle').color ?? '',
  editor.getAttributes('textStyle').fontFamily ?? '',
  editor.getAttributes('textStyle').fontSize ?? '',
  // Docs paragraph styles feed the font, size and colour controls too.
  JSON.stringify(editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').documentStyle ?? null),
].join('|');

// A pressed toolbar button must not blur the editor: blur and refocus each
// restyle the whole document. React bubbles portalled dropdown events here too.
const keepEditorFocus = (event: React.MouseEvent) => {
  const target = event.target as HTMLElement;
  if (event.button !== 0 || target.closest('input, textarea, select, label')) return;
  if (target.closest('button')) event.preventDefault();
};

export const MenuBar = ({
  editor,
  onOpenImagePicker,
  onOpenMath,
  linkRequest,
  onOpenLink,
  showFindReplace,
  onToggleFindReplace,
  zoomLevel,
  onZoomChange,
  isTocOpen,
  onTocToggle,
}: {
  editor: TiptapEditor | null;
  onOpenImagePicker: () => void;
  onOpenMath: () => void;
  linkRequest?: number;
  onOpenLink: () => void;
  showFindReplace: boolean;
  onToggleFindReplace: () => void;
  zoomLevel?: number;
  onZoomChange?: (level: number) => void;
  isTocOpen?: boolean;
  onTocToggle?: () => void;
}) => {
  const [, forceUpdate] = React.useState({});
  const compact = usePhoneLayout();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const prevMenuKeyRef = useRef('');

  React.useEffect(() => {
    if (!editor) return;
    const handleUpdate = () => {
      const key = menuBarStateKey(editor);
      if (key !== prevMenuKeyRef.current) {
        prevMenuKeyRef.current = key;
        forceUpdate({});
      }
    };
    editor.on('transaction', handleUpdate);
    editor.on('selectionUpdate', handleUpdate);
    return () => {
      editor.off('transaction', handleUpdate);
      editor.off('selectionUpdate', handleUpdate);
    };
  }, [editor]);

  if (!editor) return null;
  const btn = (active: boolean) => `editor-button${active ? ' is-active' : ''}`;

  const undoButton = (
    <button
      type="button"
      onClick={() => {
        if (editor.can?.()?.undo?.()) {
          editor.chain().focus().undo().run();
        }
      }}
      disabled={!editor.can?.()?.undo?.()}
      className="editor-button"
      title={shortcutLabel('Annulla (Ctrl+Z)')}
    >
      <Undo className="h-4 w-4" />
    </button>
  );
  const redoButton = (
    <button
      type="button"
      onClick={() => {
        if (editor.can?.()?.redo?.()) {
          editor.chain().focus().redo().run();
        }
      }}
      disabled={!editor.can?.()?.redo?.()}
      className="editor-button"
      title={shortcutLabel('Ripeti (Ctrl+Y)')}
    >
      <Redo className="h-4 w-4" />
    </button>
  );
  const zoomSelect = onZoomChange !== undefined && zoomLevel !== undefined
    ? <ZoomSelect zoomLevel={zoomLevel} onZoomChange={onZoomChange} />
    : null;
  const boldButton = (
    <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editorIsBold(editor))} title={shortcutLabel('Grassetto (Ctrl+B)')}>
      <Bold className="h-4 w-4" />
    </button>
  );
  const italicButton = (
    <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))} title={shortcutLabel('Corsivo (Ctrl+I)')}>
      <Italic className="h-4 w-4" />
    </button>
  );
  const underlineButton = (
    <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive('underline'))} title={shortcutLabel('Sottolineato (Ctrl+U)')}>
      <UnderlineIcon className="h-4 w-4" />
    </button>
  );
  const strikeButton = (
    <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive('strike'))} title="Barrato">
      <Strikethrough className="h-4 w-4" />
    </button>
  );
  const scriptControls = (
    <div className="editor-script-controls" role="group" aria-label="Apice e pedice">
      <button type="button" onClick={() => editor.chain().focus().toggleSuperscript().run()} className={btn(editor.isActive('superscript'))} title={shortcutLabel('Apice (Ctrl+.)')} aria-label={shortcutLabel('Apice (Ctrl+.)')} aria-pressed={editor.isActive('superscript')}>
        <Superscript className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleSubscript().run()} className={btn(editor.isActive('subscript'))} title={shortcutLabel('Pedice (Ctrl+,)')} aria-label={shortcutLabel('Pedice (Ctrl+,)')} aria-pressed={editor.isActive('subscript')}>
        <Subscript className="h-4 w-4" />
      </button>
    </div>
  );
  const clearFormattingButton = (
    <button
      type="button"
      onClick={() => editor.chain().focus().clearDocumentFormatting().run()}
      className="editor-button"
      title={shortcutLabel('Rimuovi formattazione (Ctrl+\\)')}
    >
      <RemoveFormatting className="h-4 w-4" />
    </button>
  );
  const insertButtons = (
    <>
      <InsertImageButton onOpenImagePicker={onOpenImagePicker} />
      <InsertYoutubeButton onOpenLink={onOpenLink} />
      <InsertMathButton onOpenMath={onOpenMath} />
      <LinkButton editor={editor} openRequest={linkRequest} />
    </>
  );
  const listButtons = (
    <>
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))} title="Elenco puntato">
        <List className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))} title="Elenco numerato">
        <ListOrdered className="h-4 w-4" />
      </button>
    </>
  );
  const quoteButton = (
    <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))} title="Citazione">
      <Quote className="h-4 w-4" />
    </button>
  );
  const findButton = (
    <button
      type="button"
      onClick={onToggleFindReplace}
      className={btn(showFindReplace)}
      title={shortcutLabel('Trova e sostituisci (Ctrl+H)')}
    >
      <Search className="h-4 w-4" />
    </button>
  );

  // Phone: one row with what a student uses while reading and fixing a sbobina, like Google Docs
  // on a phone; "Aa" opens the rest below it. The row scrolls sideways on the narrowest screens.
  if (compact) {
    return (
      <div className="editor-toolbar-compact" onMouseDown={keepEditorFocus}>
        <div className="editor-toolbar is-compact">
          <div className="editor-toolbar-row">
            {undoButton}
            <HeadingSelect editor={editor} />
            {boldButton}
            {italicButton}
            <HighlightPickerButton editor={editor} />
            {listButtons}
          </div>
          {onTocToggle && (
            <button
              type="button"
              onClick={onTocToggle}
              className={btn(Boolean(isTocOpen))}
              title="Indice"
              aria-label="Indice"
              aria-pressed={Boolean(isTocOpen)}
            >
              <ListTree className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setMoreOpen(open => !open)}
            className={btn(moreOpen)}
            title="Altri strumenti"
            aria-label="Altri strumenti"
            aria-expanded={moreOpen}
          >
            <Type className="h-4 w-4" />
          </button>
        </div>
        {moreOpen && (
          <div className="editor-toolbar editor-toolbar-more" role="group" aria-label="Altri strumenti">
            {redoButton}
            {underlineButton}
            {zoomSelect}
            <FontFamilySelect editor={editor} />
            <FontSizeSelect editor={editor} />
            {strikeButton}
            {scriptControls}
            <ColorPickerButton editor={editor} />
            {clearFormattingButton}
            {quoteButton}
            <AlignDropdownButton editor={editor} />
            {insertButtons}
            {findButton}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="editor-toolbar" onMouseDown={keepEditorFocus}>
      {undoButton}
      {redoButton}

      {zoomSelect && (
        <>
          <div className="editor-separator" />
          {zoomSelect}
        </>
      )}

      <div className="editor-separator" />
      <HeadingSelect editor={editor} />
      <FontFamilySelect editor={editor} />
      <FontSizeSelect editor={editor} />
      <div className="editor-separator" />
      {boldButton}
      {italicButton}
      {underlineButton}
      {strikeButton}
      {scriptControls}
      <ColorPickerButton editor={editor} />
      <HighlightPickerButton editor={editor} />
      {clearFormattingButton}
      <div className="editor-separator" />
      {insertButtons}
      <div className="editor-separator" />
      <AlignDropdownButton editor={editor} />
      <div className="editor-separator" />
      {listButtons}
      {quoteButton}
      <div className="editor-separator" />
      {findButton}
    </div>
  );
};
