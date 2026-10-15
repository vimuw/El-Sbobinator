import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const colors = new Map<string, number[] | null>();

function opaqueRgb(value: string): number[] | null {
  if (colors.has(value)) return colors.get(value)!;
  // Context-dependent colors must keep their authored CSS semantics.
  if (/var\(|currentcolor|inherit|initial|unset/i.test(value)) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  if (!probe.style.color) return null;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const match = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(resolved);
  const rgb = match && (match[4] === undefined || Number(match[4]) === 1) ? match.slice(1, 4).map(Number) : null;
  colors.set(value, rgb);
  return rgb;
}

function isNeutral(value?: string): boolean {
  if (!value || value === 'inherit' || value === 'initial' || value === 'unset') return true;
  return opaqueRgb(value)?.every(channel => channel === 0) ?? false;
}

function highlightInk(value: string): string | null {
  const rgb = opaqueRgb(value);
  if (!rgb) return null;
  const luminance = rgb.reduce((total, channel, index) => {
    const s = channel / 255;
    return total + [0.2126, 0.7152, 0.0722][index] * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  }, 0);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

/** Reading-only ink. Decorations never enter getHTML(), history or clipboard. */
export const EditorReadingColors = Extension.create({
  name: 'editorReadingColors',
  addProseMirrorPlugins() {
    return [new Plugin({
      state: {
        init: (_, state) => readingDecorations(state.doc),
        apply: (tr, previous) => tr.docChanged ? readingDecorations(tr.doc) : previous,
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});

function readingDecorations(doc: import('@tiptap/pm/model').Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return;
    if (!['paragraph', 'heading'].includes(block.type.name)) return false;
    block.forEach((node, offset) => {
      if (!node.isText) return;
      const explicit = node.marks.find(mark => mark.type.name === 'textStyle')?.attrs.color;
      const inherited = node.marks.some(mark => mark.type.name === 'link') ? '#1155cc' : block.attrs.documentStyle?.color;
      const ink = explicit && explicit !== 'inherit' ? explicit : inherited;
      if (!isNeutral(ink)) return;
      const highlight = node.marks.find(mark => mark.type.name === 'highlight');
      const adapted = highlight ? highlightInk(highlight.attrs.color || '#ffff00') : null;
      decorations.push(Decoration.inline(pos + 1 + offset, pos + 1 + offset + node.nodeSize, adapted
        ? { class: 'editor-reading-highlight', style: `--editor-highlight-ink:${adapted}` }
        : { class: 'editor-reading-neutral' }));
    });
    return false;
  });
  return DecorationSet.create(doc, decorations);
}
