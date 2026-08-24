import React from 'react';
import { type Editor as TiptapEditor } from '@tiptap/core';
import { ChevronDown } from 'lucide-react';

const FONT_FAMILIES = [
  { label: 'Arial', value: '' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
];

const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72'];

const HEADING_OPTIONS = [
  { label: 'Testo normale', value: 'paragraph' },
  { label: 'Titolo 1', value: 'h1' },
  { label: 'Titolo 2', value: 'h2' },
  { label: 'Titolo 3', value: 'h3' },
  { label: 'Titolo 4', value: 'h4' },
  { label: 'Titolo 5', value: 'h5' },
];

// Matches CSS: h1=20pt, h2=16pt, h3=14pt, h4=11pt, h5=10pt (same as HTML export)
const HEADING_PT: Record<number, number> = { 1: 20, 2: 16, 3: 14, 4: 11, 5: 10 };

export const FontFamilySelect = ({ editor }: { editor: TiptapEditor }) => {
  const rawFamily = editor.getAttributes('textStyle').fontFamily ?? '';
  const currentFamily = (rawFamily === '' || rawFamily === 'Arial, sans-serif' || rawFamily === 'Arial') ? '' : rawFamily;

  return (
    <div className="editor-select-wrap">
      <select
        className="editor-select font-family-select"
        value={currentFamily}
        onChange={e => {
          if (e.target.value === '') {
            editor.chain().focus().unsetFontFamily().run();
          } else {
            editor.chain().focus().setFontFamily(e.target.value).run();
          }
        }}
        title="Carattere"
      >
        {FONT_FAMILIES.map(f => (
          <option key={f.label} value={f.value}>{f.label}</option>
        ))}
      </select>
      <ChevronDown className="editor-select-chevron" />
    </div>
  );
};

export const FontSizeSelect = ({ editor }: { editor: TiptapEditor }) => {
  const getCurrentSize = () => {
    if (!editor) return '';

    // 1. Explicit inline fontSize mark
    const fontSize = editor.getAttributes('textStyle').fontSize;
    if (fontSize) return fontSize.replace(/px|pt/, '');

    // 2. Heading level — static lookup matching CSS rem values, no DOM read
    for (let i = 1; i <= 5; i++) {
      if (editor.isActive('heading', { level: i })) return String(HEADING_PT[i]);
    }

    // 3. Body text has no explicit size (11pt ≈ 14.67px, not in the dropdown)
    // Return '' so the select shows '—' rather than a wrong hardcoded value
    return '';
  };

  const currentSize = getCurrentSize();

  return (
    <div className="editor-select-wrap">
      <select
        className="editor-select font-size-select"
        value={currentSize}
        onChange={e => {
          if (e.target.value) {
            editor.chain().focus().setMark('textStyle', { fontSize: `${e.target.value}pt` }).run();
          } else {
            editor.chain().focus().setMark('textStyle', { fontSize: null }).run();
          }
        }}
        title="Dimensione carattere"
      >
        <option value="">—</option>
        {FONT_SIZES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <ChevronDown className="editor-select-chevron" />
    </div>
  );
};

export const HeadingSelect = ({ editor }: { editor: TiptapEditor }) => {
  let current = 'paragraph';
  for (let i = 1; i <= 5; i++) {
    if (editor.isActive('heading', { level: i })) { current = `h${i}`; break; }
  }
  return (
    <div className="editor-select-wrap">
      <select
        className="editor-select heading-select"
        value={current}
        onChange={e => {
          if (e.target.value === 'paragraph') {
            editor.chain().focus().setParagraph().run();
          } else {
            const level = parseInt(e.target.value.replace('h', '')) as 1 | 2 | 3 | 4 | 5;
            editor.chain().focus().setNode('heading', { level }).run();
          }
        }}
        title="Stile paragrafo"
      >
        {HEADING_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="editor-select-chevron" />
    </div>
  );
};
