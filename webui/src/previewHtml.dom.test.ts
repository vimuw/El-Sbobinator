import { describe, expect, it } from 'vitest';
import { normalizePreviewHtmlContent, ALLOWED_STYLE_PROPS, EDITOR_IMAGE_ALLOWED_DATA_ATTRS } from './previewHtml';

describe('normalizePreviewHtmlContent', () => {
  it('preserves explicit paragraph layout and native spacing when reopening a saved document', () => {
    const source = '<h2 style="line-height:1.6;margin-top:8pt;margin-bottom:10pt" data-document-line-spacing="1.6" data-extra="x">Titolo</h2><p style="line-height:1.8;margin-top:12pt;margin-bottom:6pt" data-document-line-spacing="1.8">Testo</p><span data-document-line-spacing="2">Inline</span>';
    const result = new DOMParser().parseFromString(normalizePreviewHtmlContent(source), 'text/html');
    for (const [selector, spacing, before, after] of [['h2', '1.6', '8pt', '10pt'], ['p', '1.8', '12pt', '6pt']]) {
      const block = result.querySelector<HTMLElement>(selector)!;
      expect(block.style.lineHeight).toBe(spacing);
      expect(block.style.marginTop).toBe(before);
      expect(block.style.marginBottom).toBe(after);
      expect(block.getAttribute('data-document-line-spacing')).toBe(spacing);
    }
    expect(result.querySelector('h2')!.hasAttribute('data-extra')).toBe(false);
    expect(result.querySelector('span')!.hasAttribute('data-document-line-spacing')).toBe(false);
  });

  it('preserves equation source only on its corresponding inline or block node', () => {
    const source = '<p>Prima <span data-math="x^2" data-extra="x"><span class="katex">Rendered x</span></span> dopo</p><div data-math-block="x+y">Rendered block</div><p data-math="fake" data-math-block="fake">Ordinary text</p>';
    const result = new DOMParser().parseFromString(normalizePreviewHtmlContent(source), 'text/html');
    expect(result.querySelector('span[data-math]')!.getAttribute('data-math')).toBe('x^2');
    expect(result.querySelector('div[data-math-block]')!.getAttribute('data-math-block')).toBe('x+y');
    expect(result.querySelector('span[data-math]')!.hasAttribute('data-extra')).toBe(false);
    expect(result.querySelectorAll('[data-math]')).toHaveLength(1);
    expect(result.querySelectorAll('[data-math-block]')).toHaveLength(1);
  });

  it('preserves saved empty-line typing marks only on text paragraphs', () => {
    const html = '<p data-editor-empty-marks="[{&quot;type&quot;:&quot;bold&quot;}]" data-extra="x"></p><span data-editor-empty-marks="[]">Testo</span>';
    const result = new DOMParser().parseFromString(normalizePreviewHtmlContent(html), 'text/html');
    expect(result.querySelector('p')!.getAttribute('data-editor-empty-marks')).toBe('[{"type":"bold"}]');
    expect(result.querySelector('p')!.hasAttribute('data-extra')).toBe(false);
    expect(result.querySelector('span')!.hasAttribute('data-editor-empty-marks')).toBe(false);
  });
  it('preserves a removed list marker without changing its children or following numbering', () => {
    const html = '<ol><li style="list-style-type:none"><p>Prima</p><ol type="a"><li><p>Figlia</p></li></ol></li><li><p>Seconda</p></li></ol>';
    const result = new DOMParser().parseFromString(normalizePreviewHtmlContent(html), 'text/html');
    expect(result.querySelector('ol > li')?.getAttribute('style')).toBe('list-style-type: none');
    expect(result.querySelector('ol > li > ol')?.getAttribute('type')).toBe('a');
    expect(result.querySelectorAll('ol > li')).toHaveLength(3);
  });

  it('returns empty string for empty input', () => {
    const result = normalizePreviewHtmlContent('');
    expect(result).toBe('');
  });

  it('strips disallowed data-* attributes', () => {
    const html = '<p data-bad-attr="x">hello</p>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).not.toContain('data-bad-attr');
    expect(result).toContain('hello');
  });

  it('strips align attribute', () => {
    const html = '<p align="center">text</p>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).not.toContain('align="center"');
  });

  it('preserves allowed style properties', () => {
    const html = '<p style="color: red; font-size: 14px;">styled</p>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).toContain('color');
    expect(result).toContain('font-size');
  });

  it('strips disallowed style properties', () => {
    const html = '<p style="font-size: 14px; padding: 5px;">text</p>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).toContain('font-size');
    expect(result).not.toContain('padding');
  });

  it('removes style attribute entirely when no allowed props remain', () => {
    const html = '<p style="padding: 10px;">text</p>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).not.toContain('style=');
  });

  it('preserves editor image container data-* attributes', () => {
    const html = '<div data-editor-image data-width="60" data-bad="x"><img src="img.png" /></div>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).toContain('data-editor-image');
    expect(result).toContain('data-width');
    expect(result).not.toContain('data-bad');
  });

  it('strips class from editor image containers', () => {
    const html = '<div data-editor-image class="foo"><img src="img.png" /></div>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).not.toContain('class="foo"');
  });

  it('strips class from img inside editor image container', () => {
    const html = '<div data-editor-image><img src="img.png" class="bar" data-extra="x" /></div>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).not.toContain('class="bar"');
    expect(result).not.toContain('data-extra');
    expect(result).toContain('src="img.png"');
  });

  it('handles nested elements', () => {
    const html = '<div data-foo="x"><span data-bar="y">text</span></div>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).not.toContain('data-foo');
    expect(result).not.toContain('data-bar');
    expect(result).toContain('text');
  });

  it('preserves align="center" attribute on editor image containers and images', () => {
    const html = '<div data-editor-image align="center"><img src="img.png" align="center" /></div>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).toContain('align="center"');
  });

  it('preserves and computes width attribute for images inside editor image containers', () => {
    const html = '<div data-editor-image data-width="35"><img src="img.png" /></div>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).toContain('width="222"');
    expect(result).toContain('src="img.png"');
  });

  it('keeps existing width attribute if present on img inside editor image container', () => {
    const html = '<div data-editor-image data-width="50"><img src="img.png" width="317" /></div>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).toContain('width="317"');
  });

  it('exports ALLOWED_STYLE_PROPS with expected members', () => {
    expect(ALLOWED_STYLE_PROPS.has('color')).toBe(true);
    expect(ALLOWED_STYLE_PROPS.has('font-size')).toBe(true);
    expect(ALLOWED_STYLE_PROPS.has('margin')).toBe(true);
    expect(ALLOWED_STYLE_PROPS.has('width')).toBe(true);
    expect(ALLOWED_STYLE_PROPS.has('padding')).toBe(false);
  });

  it('preserves width style property on elements such as table cells or columns', () => {
    const html = '<table><colgroup><col style="width: 150px" /></colgroup></table>';
    const result = normalizePreviewHtmlContent(html);
    expect(result).toContain('style="width: 150px"');
  });

  it('exports EDITOR_IMAGE_ALLOWED_DATA_ATTRS with expected members', () => {
    expect(EDITOR_IMAGE_ALLOWED_DATA_ATTRS.has('data-editor-image')).toBe(true);
    expect(EDITOR_IMAGE_ALLOWED_DATA_ATTRS.has('data-width')).toBe(true);
    expect(EDITOR_IMAGE_ALLOWED_DATA_ATTRS.has('data-foo')).toBe(false);
  });
});
