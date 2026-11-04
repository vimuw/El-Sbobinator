// Type-only: the editor page imports the zoom options without pulling the lazy editor chunk.
import type { ChainedCommands, Editor as TiptapEditor } from '@tiptap/core';
import { DOCUMENT_FORMATTING, pointSize } from '../../../documentFormatting';

// The options and commands of the toolbar's font, size, style and colour controls, shared with the
// phone's format sheet (PhoneFormatSheet), which runs the same commands without focusing the
// editor so the on-screen keyboard stays closed.

export const COLOR_PALETTE: string[][] = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#ffffff'],
  ['#ff0000', '#ff4500', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#9900ff'],
  ['#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#e06666', '#f6b26b', '#ffd966', '#93c47d', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#cc0000', '#e69138', '#f1c232', '#6aa84f', '#3c78d8', '#3d85c8', '#674ea7', '#a64d79'],
  ['#990000', '#b45f06', '#bf9000', '#38761d', '#1155cc', '#0b5394', '#20124d', '#4c1130'],
];

export const HIGHLIGHT_COLORS = [
  { label: 'Giallo', color: '#fef08a' },
  { label: 'Verde', color: '#bbf7d0' },
  { label: 'Azzurro', color: '#bae6fd' },
  { label: 'Rosa', color: '#fecdd3' },
  { label: 'Arancione', color: '#fed7aa' },
  { label: 'Viola', color: '#e9d5ff' },
  { label: 'Nessuno', color: '#ffffff' },
];

export const FONT_FAMILIES = [
  { label: DOCUMENT_FORMATTING.fontFamily, value: '', cssFamily: `${DOCUMENT_FORMATTING.fontFamily}, sans-serif` },
  { label: 'Times New Roman', value: '"Times New Roman", serif', cssFamily: '"Times New Roman", serif' },
  { label: 'Georgia', value: 'Georgia, serif', cssFamily: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace', cssFamily: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif', cssFamily: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif', cssFamily: '"Trebuchet MS", sans-serif' },
];

export const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72'];

// Also listed by the phone's "…" menu, where the zoom moves off the toolbar row.
export const ZOOM_OPTIONS = [50, 75, 90, 100, 125, 150, 175, 200];

export const HEADING_OPTIONS = [
  { label: 'Testo normale', value: 'paragraph', level: 0 },
  { label: 'Titolo 1', value: 'h1', level: 1 },
  { label: 'Titolo 2', value: 'h2', level: 2 },
  { label: 'Titolo 3', value: 'h3', level: 3 },
  { label: 'Titolo 4', value: 'h4', level: 4 },
  { label: 'Titolo 5', value: 'h5', level: 5 },
];

/** The family at the caret: '' for the document's own font, with the label the controls show. */
export const currentFontFamily = (editor: TiptapEditor): { value: string; label: string } => {
  const blockStyle = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').documentStyle;
  const rawFamily = editor.getAttributes('textStyle').fontFamily ?? blockStyle?.['font-family'] ?? '';
  const value = (rawFamily === '' || rawFamily === `${DOCUMENT_FORMATTING.fontFamily}, sans-serif` || rawFamily === DOCUMENT_FORMATTING.fontFamily) ? '' : rawFamily;
  const label = FONT_FAMILIES.find(f => f.value === value)?.label || (value ? value.replace(/['"]/g, '') : DOCUMENT_FORMATTING.fontFamily);
  return { value, label };
};

export const setFontFamily = (chain: ChainedCommands, value: string): ChainedCommands =>
  value === '' ? chain.unsetFontFamily().clearBlockFontFamily() : chain.setFontFamily(value);

/** The size at the caret in points, as the size control shows it. */
export const currentFontSize = (editor: TiptapEditor): string => {
  // 1. Explicit inline fontSize mark
  const fontSize = editor.getAttributes('textStyle').fontSize;
  if (fontSize) return String(pointSize(String(fontSize), DOCUMENT_FORMATTING.fontSizePt));

  const blockStyle = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').documentStyle;
  if (blockStyle?.['font-size']) return String(pointSize(blockStyle['font-size'], DOCUMENT_FORMATTING.fontSizePt));

  // 2. Heading level
  for (let i = 1; i <= 5; i++) {
    if (editor.isActive('heading', { level: i })) return String(DOCUMENT_FORMATTING.headings[i - 1].fontSizePt);
  }

  // 3. Default body text uses the same profile as the document.
  return String(DOCUMENT_FORMATTING.fontSizePt);
};

export const setFontSize = (chain: ChainedCommands, size: string): ChainedCommands =>
  chain.setMark('textStyle', { fontSize: `${size}pt` });

export const currentHeading = (editor: TiptapEditor): typeof HEADING_OPTIONS[number] => {
  for (let i = 1; i <= 5; i++) {
    if (editor.isActive('heading', { level: i })) return HEADING_OPTIONS[i];
  }
  return HEADING_OPTIONS[0];
};

export const setHeading = (chain: ChainedCommands, level: number): ChainedCommands =>
  level === 0
    ? chain.clearBlockFontSize().setParagraph()
    : chain.clearBlockFontSize().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 });
