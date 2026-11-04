import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { type ChainedCommands, type Editor as TiptapEditor } from '@tiptap/core';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Check, ChevronLeft, ChevronRight,
  IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Minus, Plus, Quote, RemoveFormatting,
  Strikethrough, Subscript, Superscript, Underline as UnderlineIcon,
} from 'lucide-react';
import { editorIsBold } from '../../../editorBold';
import { setLastHighlightColor } from '../../../editorUtils';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import {
  COLOR_PALETTE, FONT_FAMILIES, HEADING_OPTIONS, HIGHLIGHT_COLORS, currentFontFamily, currentFontSize,
  currentHeading, setFontFamily, setFontSize, setHeading,
} from './formatOptions';

type SheetView = 'text' | 'paragraph' | 'style' | 'font' | 'color' | 'highlight';

// It rises from the bottom and slides back down like the keyboard it replaces, with the curve of
// iOS sheets. Like the rest of the app (MotionConfig in App.tsx) it moves even with reduced motion.
const SHEET_TRANSITION = { duration: 0.22, ease: [0.32, 0.72, 0, 1] } as const;

const SUBVIEW_TITLES: Partial<Record<SheetView, string>> = {
  style: 'Stile',
  font: 'Carattere',
  color: 'Colore testo',
  highlight: 'Colore evidenziazione',
};

// Docs' − and + move one point at a time, within the sizes Docs accepts.
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 400;

const steppedSize = (current: string, direction: 1 | -1): string | null => {
  const next = Math.round((Number(current) + direction) * 10) / 10;
  return next < MIN_FONT_SIZE || next > MAX_FONT_SIZE ? null : String(next);
};

/**
 * The phone's "A" sheet, like Google Docs on a phone: the text and paragraph tools the short
 * toolbar row leaves out, on two tabs, with the style, font and colours on pages of their own.
 * It takes the keyboard's place at the bottom, so its commands never focus the editor: focusing
 * would bring the keyboard back over the sheet. Closing it from "A" or Esc gives the keyboard back.
 */
export const PhoneFormatSheet = ({
  editor,
  anchorRef,
  onClose,
}: {
  editor: TiptapEditor;
  /** The "A" button: a tap there toggles the sheet instead of counting as a tap outside. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: (refocus: boolean) => void;
}) => {
  const [view, setView] = React.useState<SheetView>('text');
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const tab: 'text' | 'paragraph' = view === 'paragraph' ? 'paragraph' : 'text';

  useEscapeToClose(true, () => onClose(true));

  React.useEffect(() => {
    // A tap on the page closes the sheet and, as in Docs, puts the caret where it landed.
    const handler = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node;
      if (sheetRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
    };
  }, [anchorRef, onClose]);

  // The sheet covers the lower half of the page: scroll the caret above it, as Docs does.
  React.useLayoutEffect(() => {
    const sheet = sheetRef.current;
    try {
      const scroller = editor.view.dom.closest('.editor-page-container');
      if (!sheet || !scroller) return;
      const caret = editor.view.coordsAtPos(editor.state.selection.head);
      const hidden = caret.bottom - (sheet.getBoundingClientRect().top - 24);
      if (hidden > 0) scroller.scrollTop += hidden;
    } catch {
      // No view or layout to measure yet: nothing to scroll.
    }
  }, [editor]);

  const run = (command: (chain: ChainedCommands) => ChainedCommands) => command(editor.chain()).run();
  const btn = (active: boolean) => `editor-button phone-format-toggle${active ? ' is-active' : ''}`;
  const toggle = (label: string, icon: React.ReactNode, active: boolean, command: (chain: ChainedCommands) => ChainedCommands) => (
    <button type="button" className={btn(active)} aria-label={label} title={label} aria-pressed={active} onClick={() => run(command)}>
      {icon}
    </button>
  );
  const pickedRow = (label: string, active: boolean, onPick: () => void, style?: React.CSSProperties) => (
    <button key={label} type="button" className={`phone-format-row${active ? ' is-active' : ''}`} onClick={onPick}>
      <span style={style}>{label}</span>
      {active && <Check className="h-4 w-4" aria-hidden="true" />}
    </button>
  );

  const textColor: string | undefined = editor.getAttributes('textStyle').color
    ?? editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').documentStyle?.color;
  const highlightColor: string | undefined = editor.getAttributes('highlight').color;
  const size = currentFontSize(editor);
  const smaller = steppedSize(size, -1);
  const larger = steppedSize(size, 1);
  const inList = editor.isActive('bulletList') || editor.isActive('orderedList');
  const isCenter = editor.isActive({ textAlign: 'center' });
  const isRight = editor.isActive({ textAlign: 'right' });
  const isJustify = editor.isActive({ textAlign: 'justify' });

  const textTab = (
    <>
      <div className="phone-format-toggles">
        {toggle('Grassetto', <Bold className="h-4 w-4" />, editorIsBold(editor), chain => chain.toggleBold())}
        {toggle('Corsivo', <Italic className="h-4 w-4" />, editor.isActive('italic'), chain => chain.toggleItalic())}
        {toggle('Sottolineato', <UnderlineIcon className="h-4 w-4" />, editor.isActive('underline'), chain => chain.toggleUnderline())}
        {toggle('Barrato', <Strikethrough className="h-4 w-4" />, editor.isActive('strike'), chain => chain.toggleStrike())}
        {toggle('Apice', <Superscript className="h-4 w-4" />, editor.isActive('superscript'), chain => chain.toggleSuperscript())}
        {toggle('Pedice', <Subscript className="h-4 w-4" />, editor.isActive('subscript'), chain => chain.toggleSubscript())}
      </div>
      <button type="button" className="phone-format-row" onClick={() => setView('style')}>
        <span>Stile</span>
        <span className="phone-format-value">{currentHeading(editor).label}<ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
      </button>
      <button type="button" className="phone-format-row" onClick={() => setView('font')}>
        <span>Carattere</span>
        <span className="phone-format-value">{currentFontFamily(editor).label}<ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
      </button>
      <div className="phone-format-row">
        <span>Dimensione</span>
        <span className="phone-format-value">
          <button type="button" className="editor-button" aria-label="Riduci dimensione" title="Riduci dimensione" disabled={!smaller} onClick={() => smaller && run(chain => setFontSize(chain, smaller))}>
            <Minus className="h-4 w-4" />
          </button>
          <span className="phone-format-size" aria-live="polite">{size} pt</span>
          <button type="button" className="editor-button" aria-label="Aumenta dimensione" title="Aumenta dimensione" disabled={!larger} onClick={() => larger && run(chain => setFontSize(chain, larger))}>
            <Plus className="h-4 w-4" />
          </button>
        </span>
      </div>
      <button type="button" className="phone-format-row" onClick={() => setView('color')}>
        <span>Colore testo</span>
        <span className="phone-format-value">
          <span className="phone-format-swatch" style={{ background: textColor ?? 'var(--text-primary)' }} />
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
      <button type="button" className="phone-format-row" onClick={() => setView('highlight')}>
        <span>Colore evidenziazione</span>
        <span className="phone-format-value">
          <span className={`phone-format-swatch${highlightColor ? '' : ' is-none'}`} style={highlightColor ? { background: highlightColor } : undefined} />
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
      <button type="button" className="phone-format-row" onClick={() => run(chain => chain.clearDocumentFormatting())}>
        <span>Cancella formattazione</span>
        <RemoveFormatting className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  const paragraphTab = (
    <>
      <div className="phone-format-toggles">
        {toggle('A sinistra', <AlignLeft className="h-4 w-4" />, !isCenter && !isRight && !isJustify, chain => chain.setTextAlign('left'))}
        {toggle('Al centro', <AlignCenter className="h-4 w-4" />, isCenter, chain => chain.setTextAlign('center'))}
        {toggle('A destra', <AlignRight className="h-4 w-4" />, isRight, chain => chain.setTextAlign('right'))}
        {toggle('Giustificato', <AlignJustify className="h-4 w-4" />, isJustify, chain => chain.setTextAlign('justify'))}
      </div>
      <div className="phone-format-toggles">
        {toggle('Elenco puntato', <List className="h-4 w-4" />, editor.isActive('bulletList'), chain => chain.toggleBulletList())}
        {toggle('Elenco numerato', <ListOrdered className="h-4 w-4" />, editor.isActive('orderedList'), chain => chain.toggleOrderedList())}
        {/* A phone has no Tab key: these are the only way to nest a list item. */}
        <button type="button" className="editor-button phone-format-toggle" aria-label="Riduci rientro" title="Riduci rientro" disabled={!inList} onClick={() => run(chain => chain.liftListItem('listItem'))}>
          <IndentDecrease className="h-4 w-4" />
        </button>
        <button type="button" className="editor-button phone-format-toggle" aria-label="Aumenta rientro" title="Aumenta rientro" disabled={!inList} onClick={() => run(chain => chain.sinkListItem('listItem'))}>
          <IndentIncrease className="h-4 w-4" />
        </button>
      </div>
      <button type="button" className={`phone-format-row${editor.isActive('blockquote') ? ' is-active' : ''}`} aria-pressed={editor.isActive('blockquote')} onClick={() => run(chain => chain.toggleBlockquote())}>
        <span>Citazione</span>
        <Quote className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  const subview = () => {
    if (view === 'style') {
      const current = currentHeading(editor);
      return HEADING_OPTIONS.map(option => pickedRow(option.label, current.value === option.value, () => run(chain => setHeading(chain, option.level))));
    }
    if (view === 'font') {
      const current = currentFontFamily(editor).value;
      return FONT_FAMILIES.map(family => pickedRow(family.label, current === family.value, () => run(chain => setFontFamily(chain, family.value)), { fontFamily: family.cssFamily }));
    }
    if (view === 'color') {
      return (
        <>
          <div className="phone-format-palette">
            {COLOR_PALETTE.flat().map(color => (
              <button
                key={color}
                type="button"
                className={`color-swatch${textColor === color ? ' is-selected' : ''}`}
                style={{ background: color }}
                aria-label={color}
                title={color}
                onClick={() => run(chain => chain.setColor(color))}
              />
            ))}
          </div>
          <button type="button" className="phone-format-row" onClick={() => run(chain => chain.clearDocumentColor())}>
            <span>Rimuovi colore</span>
          </button>
        </>
      );
    }
    return (
      <>
        <div className="phone-format-palette">
          {HIGHLIGHT_COLORS.filter(({ color }) => color !== '#ffffff').map(({ label, color }) => (
            <button
              key={color}
              type="button"
              className={`color-swatch${highlightColor === color ? ' is-selected' : ''}`}
              style={{ background: color }}
              aria-label={label}
              title={label}
              onClick={() => { setLastHighlightColor(color); run(chain => chain.setHighlight({ color })); }}
            />
          ))}
        </div>
        <button type="button" className="phone-format-row" onClick={() => run(chain => chain.unsetHighlight())}>
          <span>Rimuovi evidenziatore</span>
        </button>
      </>
    );
  };

  const subviewTitle = SUBVIEW_TITLES[view];
  return createPortal(
    <motion.div
      ref={sheetRef}
      className="phone-format-sheet"
      role="dialog"
      aria-label="Formato"
      initial={{ y: '100%' }}
      animate={{ y: 0, transition: SHEET_TRANSITION }}
      exit={{ y: '100%', transition: SHEET_TRANSITION }}
    >
      {subviewTitle ? (
        <div className="phone-format-header">
          <button type="button" className="editor-button" aria-label="Indietro" title="Indietro" onClick={() => setView('text')}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="phone-format-title">{subviewTitle}</span>
        </div>
      ) : (
        <div className="phone-format-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'text'} className={`phone-format-tab${tab === 'text' ? ' is-active' : ''}`} onClick={() => setView('text')}>Testo</button>
          <button type="button" role="tab" aria-selected={tab === 'paragraph'} className={`phone-format-tab${tab === 'paragraph' ? ' is-active' : ''}`} onClick={() => setView('paragraph')}>Paragrafo</button>
        </div>
      )}
      <div className="phone-format-body">
        {subviewTitle ? subview() : tab === 'text' ? textTab : paragraphTab}
      </div>
    </motion.div>,
    document.body,
  );
};
