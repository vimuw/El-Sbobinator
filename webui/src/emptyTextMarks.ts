import type { Mark } from '@tiptap/pm/model';

export const attribute = 'data-editor-empty-marks';
const typingMarks = new Set(['bold', 'italic', 'underline', 'strike', 'textStyle', 'highlight']);
type EmptyTextMark = { type: string; attrs?: Record<string, unknown> };

export function readMarks(value: unknown): EmptyTextMark[] | null {
  if (!Array.isArray(value)) return null;
  const marks = value.filter((mark): mark is EmptyTextMark => mark && typeof mark === 'object'
    && typeof mark.type === 'string' && typingMarks.has(mark.type)
    && (mark.attrs === undefined || mark.attrs && typeof mark.attrs === 'object' && !Array.isArray(mark.attrs)));
  return marks.length ? marks : null;
}

export function parseMarks(element: HTMLElement): EmptyTextMark[] | null {
  try { return readMarks(JSON.parse(element.getAttribute(attribute) ?? 'null')); }
  catch { return null; }
}

export const savedEmptyTextMarks = (marks: readonly Mark[]) => readMarks(marks.map(mark => mark.toJSON()));

/** Materialize only empty-line typography in the portable clipboard fragment. */
export function applyEmptyTextMarks(element: HTMLElement): void {
  if (!element.matches('p,h1,h2,h3,h4,h5,h6') || element.textContent || element.children.length) return;
  const marks = parseMarks(element);
  if (!marks) return;
  applyMarks(element, marks);
}

function applyMarks(element: HTMLElement, marks: EmptyTextMark[]): void {
  const decorations: string[] = [];
  for (const mark of marks) {
    if (mark.type === 'bold') element.style.fontWeight = '700';
    if (mark.type === 'italic') element.style.fontStyle = 'italic';
    if (mark.type === 'underline') decorations.push('underline');
    if (mark.type === 'strike') decorations.push('line-through');
    if (mark.type === 'textStyle') {
      for (const [key, property] of Object.entries({ fontFamily: 'font-family', fontSize: 'font-size', color: 'color' })) {
        const value = mark.attrs?.[key];
        if (typeof value === 'string') element.style.setProperty(property, value);
      }
    }
    if (mark.type === 'highlight') element.style.backgroundColor = typeof mark.attrs?.color === 'string' ? mark.attrs.color : '#ffff00';
  }
  if (decorations.length) element.style.textDecoration = decorations.join(' ');
}

/** Live empty-line metrics, without painting a paragraph-wide highlight. */
export function emptyTextMarksTypography(value: unknown): string {
  const marks = readMarks(value);
  if (!marks) return '';
  const element = document.createElement('p');
  applyMarks(element, marks);
  element.style.removeProperty('background-color');
  element.style.removeProperty('text-decoration');
  return element.style.cssText;
}

