import React, { useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { type Editor as TiptapEditor } from '@tiptap/core';
import {
  Baseline, Bold, ChevronDown, ImagePlus, Italic, Link2, List, ListOrdered, Plus, Quote, Redo2,
  RemoveFormatting, Search, Sigma, SquarePlay, Strikethrough,
  Underline as UnderlineIcon, Undo2,
} from 'lucide-react';
import {
  ColorPickerButton, HighlightPickerButton, FontFamilySelect,
  FontSizeSelect, HeadingSelect, LinkButton, AlignDropdownButton,
  InsertImageButton, InsertMathButton, InsertYoutubeButton,
  ScriptDropdownButton, ZoomSelect,
} from './EditorToolbarControls';
import { editorIsBold } from '../editorBold';
import { shortcutLabel } from '../keyboardLabels';
import { usePhoneLayout } from '../hooks/usePhoneLayout';
import { useToolbarOverflow } from '../hooks/useToolbarOverflow';
import { KebabMenu } from './KebabMenu';
import { PhoneFormatSheet } from './editor/toolbar/PhoneFormatSheet';

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

// Marks which edges of the phone's scrolling row hide more tools, for the CSS fades.
const markRowEdges = (row: HTMLElement) => {
  row.toggleAttribute('data-more-left', row.scrollLeft > 1);
  row.toggleAttribute('data-more-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
};

// Also on mount and whenever the row's width changes (rotation, a resized window).
const trackRowEdges = (row: HTMLElement | null) => {
  if (!row) return;
  markRowEdges(row);
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => markRowEdges(row));
  observer.observe(row);
  return () => observer.disconnect();
};

// Opens the wrapped lines of the tablet toolbar.
const MoreToolsButton = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    className={`editor-button editor-more-button${open ? ' is-active' : ''}`}
    title={open ? 'Nascondi altri strumenti' : 'Altri strumenti'}
    aria-label="Altri strumenti"
    aria-expanded={open}
  >
    <ChevronDown className="h-4 w-4" />
  </button>
);

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
  zoomInHeaderMenu = false,
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
  /** Phone: the editor header's "…" menu already offers the zoom (EditorFullPage). */
  zoomInHeaderMenu?: boolean;
}) => {
  const [, forceUpdate] = React.useState({});
  const compact = usePhoneLayout();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const prevMenuKeyRef = useRef('');
  const [groupsRef, overflowing] = useToolbarOverflow();
  const insertAnchorRef = useRef<HTMLSpanElement>(null);
  const [formatOpen, setFormatOpen] = React.useState(false);
  const formatButtonRef = useRef<HTMLButtonElement>(null);
  const refocusAfterFormatRef = useRef(false);
  // Once everything fits again the lines close, so the next overflow starts folded.
  if (moreOpen && !overflowing) setMoreOpen(false);
  if (formatOpen && !compact) setFormatOpen(false);

  // The keyboard comes back only if it was open when "A" closed it.
  const closeFormat = React.useCallback((refocus: boolean) => {
    setFormatOpen(false);
    if (refocus && refocusAfterFormatRef.current) editor?.commands.focus();
  }, [editor]);

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
      <Undo2 className="h-4 w-4" />
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
      <Redo2 className="h-4 w-4" />
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
      <LinkButton editor={editor} openRequest={linkRequest} />
      <InsertImageButton onOpenImagePicker={onOpenImagePicker} />
      <InsertMathButton onOpenMath={onOpenMath} />
      <InsertYoutubeButton onOpenLink={onOpenLink} />
    </>
  );
  const bulletListButton = (
    <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))} title="Elenco puntato">
      <List className="h-4 w-4" />
    </button>
  );
  const orderedListButton = (
    <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))} title="Elenco numerato">
      <ListOrdered className="h-4 w-4" />
    </button>
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

  // Phone: like Google Docs on a phone, the row keeps the tools used most while fixing a sbobina
  // and scrolls sideways when they do not fit; the edge fades while there is more to scroll to.
  // Undo and redo stay pinned at its start and "A" at its end, so they never scroll away; "A" opens the sheet with the rest (style, font, size, the rarer marks, indent).
  // "+" lists what can be inserted by name and sits beside "A": both change the text, so they
  // stay on the toolbar rather than among the header's page actions. Given the header's "…"
  // menu, the zoom goes there, with the index and search.
  if (compact) {
    const separator = <div className="editor-separator" />;
    const toggleFormat = () => {
      if (formatOpen) {
        closeFormat(true);
        return;
      }
      // The sheet takes the keyboard's place, as in Docs: blurring the editor puts it away.
      refocusAfterFormatRef.current = editor.isFocused;
      (editor.view?.dom as HTMLElement | undefined)?.blur();
      setFormatOpen(true);
    };
    const insertMenu = (
      <span ref={insertAnchorRef} className="editor-insert-menu">
        <KebabMenu
          icon={<Plus className="h-4 w-4" />}
          ariaLabel="Inserisci"
          buttonClassName="editor-insert-menu-button"
          items={[
            { label: 'Link', icon: <Link2 className="h-4 w-4" />, onClick: onOpenLink },
            { label: 'Immagine', icon: <ImagePlus className="h-4 w-4" />, onClick: onOpenImagePicker },
            { label: 'Formula', icon: <Sigma className="h-4 w-4" />, onClick: onOpenMath },
            { label: 'Video YouTube', icon: <SquarePlay className="h-4 w-4" />, onClick: onOpenLink },
          ]}
        />
      </span>
    );
    return (
      <div className="editor-toolbar-compact" onMouseDown={keepEditorFocus}>
        <div className="editor-toolbar is-compact">
          <div className="editor-toolbar-pinned is-start">
            {undoButton}
            {redoButton}
          </div>
          <div className="editor-toolbar-row" ref={trackRowEdges} onScroll={event => markRowEdges(event.currentTarget)}>
            {boldButton}
            {italicButton}
            {underlineButton}
            <HighlightPickerButton editor={editor} />
            <ColorPickerButton editor={editor} />
            {separator}
            {bulletListButton}
            {orderedListButton}
            {separator}
            <AlignDropdownButton editor={editor} />
            {!zoomInHeaderMenu && zoomSelect && (
              <>
                {separator}
                {zoomSelect}
              </>
            )}
          </div>
          <div className="editor-toolbar-pinned is-end">
            <button
              ref={formatButtonRef}
              type="button"
              onClick={toggleFormat}
              className={`editor-button editor-format-button${formatOpen ? ' is-active' : ''}`}
              title="Formato"
              aria-label="Formato"
              aria-expanded={formatOpen}
            >
              <Baseline className="h-4 w-4" />
            </button>
            {insertMenu}
          </div>
          {/* Kept mounted while it slides back down, like the keyboard it gives way to. */}
          <AnimatePresence>
            {formatOpen && <PhoneFormatSheet key="format-sheet" editor={editor} anchorRef={formatButtonRef} onClose={closeFormat} />}
          </AnimatePresence>
          <LinkButton editor={editor} openRequest={linkRequest} hideButton anchorRef={insertAnchorRef} />
        </div>
      </div>
    );
  }

  // Tablets and narrow windows: the groups that do not fit on the first line fold behind the
  // arrow, like Google Docs, instead of pushing the page down with a second and third line.
  // Each group carries its leading separator, so a group wraps whole. Style, font and size open
  // the line as in Google Docs; after them the groups run from the tools a student uses most
  // while fixing a sbobina to the least used, so a narrow window folds those away first.
  return (
    <div
      className={`editor-toolbar editor-toolbar-full${moreOpen ? ' is-expanded' : ''}`}
      onMouseDown={keepEditorFocus}
    >
      <div className="editor-toolbar-groups" ref={groupsRef}>
        <div className="editor-toolbar-group">
          {undoButton}
          {redoButton}
        </div>
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          <HeadingSelect editor={editor} />
        </div>
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          <FontFamilySelect editor={editor} />
          <FontSizeSelect editor={editor} />
        </div>
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          {boldButton}
          {italicButton}
          {underlineButton}
        </div>
        {/* Split without a separator: on a portrait iPad bold and italic stay out even when
            the colours fold. */}
        <div className="editor-toolbar-group">
          <HighlightPickerButton editor={editor} />
          <ColorPickerButton editor={editor} />
        </div>
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          {bulletListButton}
          {orderedListButton}
        </div>
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          {findButton}
        </div>
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          {insertButtons}
        </div>
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          <AlignDropdownButton editor={editor} />
        </div>
        {/* The least used text tools; the quote is rare in a sbobina, so it folds with them. */}
        <div className="editor-toolbar-group">
          <div className="editor-separator" />
          {strikeButton}
          <ScriptDropdownButton editor={editor} />
          {quoteButton}
          {clearFormattingButton}
        </div>
        {zoomSelect && (
          <div className="editor-toolbar-group">
            <div className="editor-separator" />
            {zoomSelect}
          </div>
        )}
      </div>
      {overflowing && <MoreToolsButton open={moreOpen} onToggle={() => setMoreOpen(open => !open)} />}
    </div>
  );
};
