import formatting from '../../el_sbobinator/document_formatting.json';
import { applyEmptyTextMarks } from './emptyTextMarks';

// The same profile is read by Python's standalone HTML export.
export const DOCUMENT_FORMATTING = formatting;
export const EDITOR_CONTENT_WIDTH_PX = formatting.contentWidthPx;

// HTML's type attribute alone is ignored by Docs paste; write CSS on the list
// and its own items as well. Keep imported marker choices, including nesting.
export const orderedListStyle = (element: HTMLElement): string => {
  const css = element.style.listStyleType;
  if (['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'].includes(css)) return css;
  const type = element.getAttribute('type') ?? '';
  return ['a', 'A', 'i', 'I'].includes(type)
    ? ({ a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' } as Record<string, string>)[type]
    : 'decimal';
};

export const headingStyle = (element: HTMLElement) => {
  const level = /^H([1-6])$/.exec(element.tagName)?.[1];
  return level ? formatting.headings[Number(level) - 1] : null;
};

/** Resolve document units, without depending on UI zoom, theme or viewport. */
export const pointSize = (value: string, fallback: number, parentPt = fallback): number => {
  const match = /^(-?\d*\.?\d+)(pt|px|rem|em|%)?$/i.exec(value.trim());
  if (!match) return fallback;
  const n = Number(match[1]);
  switch (match[2]?.toLowerCase()) {
    case 'px': return n * 0.75;
    case 'rem': return n * 12;
    case 'em': return n * parentPt;
    case '%': return n * parentPt / 100;
    default: return n;
  }
};

export const editorFormattingVariables = (): string => {
  const variables: Record<string, string | number> = {
    'font-family': formatting.fontFamily,
    'font-size': `${formatting.fontSizePt}pt`,
    'line-height': formatting.lineHeight,
    'paragraph-gap': `${formatting.paragraphGapPt}pt`,
  };
  formatting.headings.forEach((style, i) => {
    variables[`h${i + 1}-size`] = `${style.fontSizePt}pt`;
    variables[`h${i + 1}-line-height`] = style.lineHeight;
    variables[`h${i + 1}-before`] = `${style.beforePt}pt`;
    variables[`h${i + 1}-after`] = `${style.afterPt}pt`;
    variables[`h${i + 1}-weight`] = style.fontWeight;
    variables[`h${i + 1}-color`] = style.color;
  });
  return Object.entries(variables).map(([key, value]) => `--document-${key}:${value}`).join(';');
};

type ParagraphSpacing = { beforePt: number; afterPt: number };
export const DOCUMENT_PARAGRAPH_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,pre,[data-math-block]';

/** Collapse each semantic gap once. Table cells own independent paragraph groups. */
export function paragraphSpacing(root: HTMLElement): Map<HTMLElement, ParagraphSpacing> {
  const result = new Map<HTMLElement, ParagraphSpacing>();
  const groups = new Map<Element, Array<{ element: HTMLElement; top: number; bottom: number }>>();
  const elements = Array.from(root.querySelectorAll<HTMLElement>(DOCUMENT_PARAGRAPH_SELECTOR));
  // Bare list items and empty cells also need an anchor in the native format.
  elements.push(...Array.from(root.querySelectorAll<HTMLElement>('li,td,th')).filter(el => !el.querySelector(DOCUMENT_PARAGRAPH_SELECTOR)));
  elements.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1);
  for (const element of elements) {
    if (element.closest('[data-editor-image]')) continue;
    const heading = headingStyle(element);
    const fontSize = pointSize(element.style.fontSize, heading?.fontSizePt ?? formatting.fontSizePt);
    const top = pointSize(element.style.marginTop, heading?.beforePt ?? formatting.paragraphGapPt, fontSize);
    const bottom = pointSize(element.style.marginBottom, heading?.afterPt ?? formatting.paragraphGapPt, fontSize);
    const owner = element.closest('td,th') ?? root;
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner)!.push({ element, top, bottom });
    result.set(element, { beforePt: 0, afterPt: element.style.marginBottom ? bottom : 0 });
  }
  for (const [owner, paragraphs] of groups) {
    const first = paragraphs[0];
    if (first.element.style.marginTop || (owner === root && headingStyle(first.element))) result.get(first.element)!.beforePt = first.top;
    for (let i = 1; i < paragraphs.length; i++) {
      const previous = paragraphs[i - 1];
      const current = paragraphs[i];
      const previousLevel = Number(/^H([1-6])$/.exec(previous.element.tagName)?.[1]);
      const suppress = formatting.suppressMarginAfterHeadingLevels.includes(previousLevel)
        && current.element.previousElementSibling === previous.element && !headingStyle(current.element)
        && !current.element.style.marginTop;
      const top = suppress ? 0 : current.top;
      // Keep the winning gap on the block that owns it. This also preserves
      // Docs heading space-before rather than moving it onto preceding text.
      if (top > previous.bottom) {
        result.get(previous.element)!.afterPt = 0;
        result.get(current.element)!.beforePt = top;
      } else result.get(previous.element)!.afterPt = previous.bottom;
    }
  }
  return result;
}

/** A standalone fragment: semantic tags plus explicit styles, no app CSS required. */
export function formatPortableHtml(root: HTMLElement): void {
  root.querySelectorAll('.image-wrap-gap,.editor-image-toolbar,.editor-image-resize-handles').forEach(el => el.remove());
  // The MathML accessibility layer and the visual KaTeX layer describe the
  // same formula. Rich paste without the KaTeX stylesheet would import both.
  root.querySelectorAll('.katex-mathml').forEach(el => el.remove());
  const visit = (element: HTMLElement, family: string, fontSizePt: number, lineHeight: string, alignment: string) => {
    if (element.matches('script,style')) { element.remove(); return; }
    applyEmptyTextMarks(element);
    const heading = headingStyle(element);
    const size = pointSize(element.style.fontSize, heading?.fontSizePt ?? fontSizePt, fontSizePt);
    const explicitFont = element.style.fontFamily;
    const font = explicitFont || (element.matches('code,pre') ? 'Courier New' : family);
    const explicitLeading = element.style.lineHeight;
    const leading = explicitLeading || String(heading?.lineHeight ?? lineHeight);
    const align = element.style.textAlign || alignment;
    // Rendered KaTeX and image surfaces have their own geometry; keep it intact.
    if (element.closest('[data-editor-image],.katex')) return;
    element.style.fontFamily = font;
    element.style.fontSize = `${size}pt`;
    if (element.matches(DOCUMENT_PARAGRAPH_SELECTOR) || element.matches('li')) {
      element.style.lineHeight ||= leading;
      if (!explicitLeading && leading === String(formatting.lineHeight)) element.setAttribute('data-document-line-spacing', String(formatting.nativeLineHeight));
      if (align) element.style.textAlign ||= align;
    }
    if (!element.style.color) element.style.color = heading?.color ?? (element.matches('a') ? '#1155cc' : 'inherit');
    if (heading) element.style.fontWeight ||= String(heading.fontWeight);
    if (element.matches('strong,b,th')) element.style.fontWeight ||= '700';
    if (element.matches('em,i')) element.style.fontStyle ||= 'italic';
    if (element.matches('u,a')) element.style.textDecoration ||= 'underline';
    if (element.matches('s,del,strike')) element.style.textDecoration ||= 'line-through';
    if (element.matches('mark')) element.style.backgroundColor ||= '#ffff00';
    if (element.matches('ul,ol')) {
      element.style.paddingLeft ||= '36pt';
      element.style.marginTop = element.style.marginBottom = '0';
      if (element.matches('ol')) {
        element.style.listStyleType = orderedListStyle(element);
        Array.from(element.children).forEach(child => {
          if (child instanceof HTMLElement && child.matches('li') && child.style.listStyleType !== 'none') child.style.listStyleType = element.style.listStyleType;
        });
      }
    }
    if (element.matches('li') && element.querySelector(DOCUMENT_PARAGRAPH_SELECTOR)) element.style.marginTop = element.style.marginBottom = '0';
    if (element.matches('blockquote')) { element.style.marginLeft ||= '30pt'; element.style.marginRight ||= '30pt'; }
    if (element.matches('table')) { element.style.borderCollapse ||= 'collapse'; element.style.width ||= '100%'; }
    if (element.matches('td,th')) {
      element.style.border ||= '0.75pt solid #e6e6e6';
      element.style.padding ||= `${formatting.table.paddingVerticalPt}pt ${formatting.table.paddingHorizontalPt}pt`;
      element.style.verticalAlign ||= 'top';
    }
    Array.from(element.children).forEach(child => { if (child instanceof HTMLElement) visit(child, font, size, leading, align); });
  };
  // A wrapper is necessary for text-only selections that contain no paragraph.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `font-family:${formatting.fontFamily};font-size:${formatting.fontSizePt}pt;line-height:${formatting.lineHeight};color:#000000;`;
  Array.from(root.children).forEach(child => { if (child instanceof HTMLElement) visit(child, formatting.fontFamily, formatting.fontSizePt, String(formatting.lineHeight), ''); });
  // Resolve inherited typography first: an em margin belongs to that block's font.
  for (const [element, gap] of paragraphSpacing(root)) {
    if (element.style.marginTop !== `${gap.beforePt}pt`) element.style.marginTop = `${gap.beforePt}pt`;
    if (element.style.marginBottom !== `${gap.afterPt}pt`) element.style.marginBottom = `${gap.afterPt}pt`;
    element.style.lineHeight ||= String(headingStyle(element)?.lineHeight ?? formatting.lineHeight);
  }
  while (root.firstChild) wrapper.appendChild(root.firstChild);
  // Repeated preparation reuses the existing envelope rather than nesting it.
  if (wrapper.children.length === 1 && wrapper.firstElementChild?.hasAttribute('data-document-format')) {
    root.appendChild(wrapper.firstElementChild);
  } else {
    wrapper.setAttribute('data-document-format', '1');
    root.appendChild(wrapper);
  }
}

export function clipboardPlainText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script,style,.image-wrap-gap,.editor-image-toolbar,.editor-image-resize-handles').forEach(el => el.remove());
  clone.querySelectorAll('[data-math],[data-math-block]').forEach(el => el.replaceWith(document.createTextNode((el.getAttribute('data-math') ?? el.getAttribute('data-math-block') ?? '') + (el.hasAttribute('data-math-block') ? '\n' : ''))));
  clone.querySelectorAll('br').forEach(el => el.replaceWith(document.createTextNode('\n')));
  // Finish descendants before their containers so li/tr do not add a second
  // separator after the paragraph or nested list that already ends the item.
  Array.from(clone.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre,li,tr,figcaption')).reverse().forEach(el => {
    if (!el.textContent?.endsWith('\n')) el.append('\n');
  });
  return clone.textContent ?? '';
}
