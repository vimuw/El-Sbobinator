import { DOCUMENT_FORMATTING, pointSize } from './documentFormatting';

const CSS_LEADING_ATTRIBUTE = 'data-editor-css-line-height';
export const EMPTY_PARAGRAPH_ATTRIBUTE = 'data-editor-empty-paragraph';

/** Read only bounded CSS values emitted by our clipboard adapter. */
export function clipboardCssLineHeight(element: HTMLElement): string | null {
  const value = element.getAttribute(CSS_LEADING_ATTRIBUTE) ?? '';
  if (value === 'normal') return value;
  const match = /^(\d*\.?\d+)(pt|px|em|rem|%)?$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return amount > 0 && amount <= (match[2] ? 1000 : 10) ? value : null;
}

/** CSS leading uses font-size; Docs uses the font's normal line height. */
export function nativeLineSpacingReader(): (element: HTMLElement) => number {
  const normalLines = new Map<string, number>();
  return element => {
    const profileSpacing = Number(element.getAttribute('data-document-line-spacing'));
    if (profileSpacing > 0 && profileSpacing <= 10) return profileSpacing;
    const fontPt = pointSize(element.style.fontSize, DOCUMENT_FORMATTING.fontSizePt);
    const leading = clipboardCssLineHeight(element) || element.style.lineHeight || String(DOCUMENT_FORMATTING.lineHeight);
    if (leading === 'normal') return 1;
    const unitless = /^\d*\.?\d+$/.test(leading);
    const desiredPt = unitless ? Number(leading) * fontPt : pointSize(leading, fontPt, fontPt);
    const key = `${element.style.fontFamily}:${element.style.fontWeight}:${element.style.fontStyle}`;
    let normalEm = normalLines.get(key);
    if (normalEm === undefined) {
      const probe = document.createElement('div');
      probe.textContent = 'M';
      probe.style.cssText = 'all:initial;position:fixed;left:-10000px;top:0;display:block;width:max-content;height:auto;padding:0;border:0;margin:0;line-height:normal;visibility:hidden;';
      probe.style.fontFamily = element.style.fontFamily || DOCUMENT_FORMATTING.fontFamily;
      // Large em measurement avoids pixel rounding at typical body sizes.
      const measurementFontPt = 1000;
      probe.style.fontSize = `${measurementFontPt}pt`;
      probe.style.fontWeight = element.style.fontWeight || '400';
      probe.style.fontStyle = element.style.fontStyle || 'normal';
      document.body.appendChild(probe);
      normalEm = probe.getBoundingClientRect().height * 0.75 / measurementFontPt;
      probe.remove();
      normalLines.set(key, normalEm);
    }
    // DOM-only tests have no font layout. Real browsers measure the chosen font.
    return normalEm > 0 ? desiredPt / (normalEm * fontPt) : desiredPt / fontPt;
  };
}

/** Adapt only clipboard HTML; standalone exports and saved HTML retain CSS. */
export function prepareHtmlLineSpacing(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const lineSpacing = nativeLineSpacingReader();
  for (const block of body.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li')) {
    if (block.closest('[data-editor-image],.katex') || clipboardCssLineHeight(block)) continue;
    const leading = block.style.lineHeight;
    if (!leading) continue;
    block.setAttribute(CSS_LEADING_ATTRIBUTE, leading);
    if (!clipboardCssLineHeight(block)) { block.removeAttribute(CSS_LEADING_ATTRIBUTE); continue; }
    // Docs takes a list item's leading from li even when its first paragraph
    // has a custom value. Use that same paragraph as the native adapter.
    const firstParagraph = block.matches('li') && block.firstElementChild?.matches('p,h1,h2,h3,h4,h5,h6')
      ? block.firstElementChild as HTMLElement : block;
    block.style.lineHeight = String(lineSpacing(firstParagraph));
    // A list owns blocks as well as inline runs. Never put a nested list,
    // paragraph or an image surface inside the transport span.
    let run: HTMLSpanElement | null = null;
    for (const child of Array.from(block.childNodes)) {
      if (child instanceof HTMLElement && child.matches('p,h1,h2,h3,h4,h5,h6,ul,ol,div,pre,table,blockquote,[data-editor-image]')) { run = null; continue; }
      if (!run) {
        run = document.createElement('span');
        run.style.lineHeight = leading === 'normal' ? 'normal' : `calc(${leading})`;
        block.insertBefore(run, child);
      }
      run.appendChild(child);
    }
  }
  // Docs drops empty p runs between a list and a table. Its own HTML uses a
  // block-level br; a styled div also retains the separator's paragraph layout.
  // Keep this transport representation outside persisted/standalone HTML.
  for (const list of body.querySelectorAll('ol,ul')) {
    const parent = list.parentElement;
    const atRoot = parent === body || parent?.parentElement === body && parent.hasAttribute('data-document-format');
    if (!atRoot) continue;
    const paragraphs: Element[] = [];
    let next = list.nextElementSibling;
    while (next?.matches('p') && !next.childNodes.length) {
      paragraphs.push(next);
      next = next.nextElementSibling;
    }
    if (!next?.matches('table')) continue;
    for (const paragraph of paragraphs) {
      const separator = document.createElement('div');
      for (const attribute of Array.from(paragraph.attributes)) separator.setAttribute(attribute.name, attribute.value);
      separator.setAttribute(EMPTY_PARAGRAPH_ATTRIBUTE, 'true');
      separator.appendChild(document.createElement('br'));
      paragraph.replaceWith(separator);
    }
  }
  return body.innerHTML;
}
