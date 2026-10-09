import { normalizeImageWidth } from './imageLayout';

export const EDITOR_IMAGE_ALLOWED_DATA_ATTRS = new Set(['data-editor-image', 'data-layout', 'data-align', 'data-width', 'data-position', 'data-offset-y', 'data-offset-x', 'data-aspect-ratio', 'data-caption']);
export const ALLOWED_STYLE_PROPS = new Set(['font-size', 'color', 'font-family', 'background-color', 'text-align', 'font-weight', 'font-style', 'text-decoration', 'line-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'margin', 'width', 'white-space']);

export const normalizePreviewHtmlContent = (content: string) => {
  const parsed = new DOMParser().parseFromString(`<body>${content || ''}</body>`, 'text/html');

  parsed.body.querySelectorAll('p').forEach(p => {
    if (p.textContent && p.textContent.includes('Connessione in corso alla stanza condivisa')) {
      p.remove();
    }
  });

  parsed.body.querySelectorAll('*').forEach(element => {
    const tag = element.tagName.toLowerCase();
    const isEditorImageContainer = ['div', 'span', 'figure'].includes(tag) && element.hasAttribute('data-editor-image');
    const isEditorImageAsset = tag === 'img' && !!element.closest('[data-editor-image]');

    if (!isEditorImageContainer && !isEditorImageAsset) {
      element.removeAttribute('align');
      const htmlEl = element as HTMLElement;
      const allowedStyles = Array.from(htmlEl.style ?? [])
        .filter(prop => ALLOWED_STYLE_PROPS.has(prop) || (tag === 'li' && prop === 'list-style-type' && htmlEl.style.listStyleType === 'none'))
        .map(prop => `${prop}: ${htmlEl.style.getPropertyValue(prop)}`);
      // Chromium enumerates white-space as its longhands, whereas jsdom
      // enumerates the shorthand. Read it explicitly before filtering styles.
      if (htmlEl.style?.whiteSpace === 'pre-wrap' && !Array.from(htmlEl.style).includes('white-space')) {
        allowedStyles.push('white-space: pre-wrap');
      }
      if (allowedStyles.length) {
        element.setAttribute('style', allowedStyles.join('; '));
      } else {
        element.removeAttribute('style');
      }
      Array.from(element.attributes)
        .filter(attribute => attribute.name.startsWith('data-')
          && !(['data-editor-empty-marks', 'data-document-line-spacing', 'data-generated-space-before'].includes(attribute.name) && /^(p|h[1-6])$/.test(tag))
          && !(attribute.name === 'data-math' && tag === 'span')
          && !(attribute.name === 'data-math-block' && tag === 'div'))
        .forEach(attribute => element.removeAttribute(attribute.name));
      return;
    }

    if (isEditorImageContainer) {
      Array.from(element.attributes)
        .filter(attribute => attribute.name.startsWith('data-') && !EDITOR_IMAGE_ALLOWED_DATA_ATTRS.has(attribute.name))
        .forEach(attribute => element.removeAttribute(attribute.name));
      element.removeAttribute('class');
      return;
    }

    if (isEditorImageAsset) {
      element.removeAttribute('class');
      Array.from(element.attributes)
        .filter(attribute => attribute.name.startsWith('data-'))
        .forEach(attribute => element.removeAttribute(attribute.name));

      const parentContainer = element.closest<HTMLElement>('[data-editor-image]');
      const widthAttr = element.getAttribute('width');
      if (!widthAttr && parentContainer) {
        const rawWidth = parentContainer.getAttribute('data-width') || parentContainer.style.width || '56';
        const validPercent = normalizeImageWidth(rawWidth);
        const targetPx = Math.round((EDITOR_CONTENT_WIDTH_PX * validPercent) / 100);
        element.setAttribute('width', String(targetPx));
      }
      return;
    }

    element.removeAttribute('class');
    Array.from(element.attributes)
      .filter(attribute => attribute.name.startsWith('data-'))
      .forEach(attribute => element.removeAttribute(attribute.name));
  });

  return parsed.body.innerHTML;
};
import { EDITOR_CONTENT_WIDTH_PX } from './documentFormatting';
