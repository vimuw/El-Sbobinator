import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { RichTextEditor } from './RichTextEditor';
import { prepareHtmlForClipboard } from '../utils';
import { normalizePreviewHtmlContent } from '../previewHtml';

describe('FloatingImage selection and resize handles', () => {
  beforeAll(() => {
    // JSDOM has no layout hit testing; native browser behavior is covered by the E2E test.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  });
  it('offers only inline and wrap and preserves arbitrary wrap coordinates through copy and reopening', async () => {
    let getHtml: (() => string) | undefined;
    const { unmount } = render(<RichTextEditor initialContent={'<p>Prima <span data-editor-image data-layout="wrap" data-position="43" data-offset-y="28" data-width="35"><img src="layout.png" alt="layout test"></span> Dopo</p>'} onEditorReady={fn => { getHtml = fn; }} />);
    const img = await screen.findByAltText('layout test');
    await act(async () => { fireEvent.mouseDown(img); });
    expect((await screen.findByRole('button', { name: 'Wrap' })).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Testo sopra e sotto' })).toBeNull();
    const preview = normalizePreviewHtmlContent(await prepareHtmlForClipboard(getHtml!()));
    const container = new DOMParser().parseFromString(preview, 'text/html').querySelector<HTMLElement>('[data-editor-image]')!;
    expect(container.dataset.layout).toBe('wrap');
    expect(container.dataset.position).toBe('43');
    expect(container.dataset.offsetY).toBe('28');
    expect(container.querySelector('img')?.getAttribute('width')).toBe('222');
    unmount();
    render(<RichTextEditor initialContent={preview} />);
    const reopened = (await screen.findByAltText('layout test')).closest('.editor-image-node') as HTMLElement;
    expect(reopened.dataset.position).toBe('43');
    expect(reopened.dataset.offsetY).toBe('28');
  });

  it('keeps a default inline image between words and switches both modes without changing text', async () => {
    let getHtml: (() => string) | undefined;
    render(<RichTextEditor initialContent={'<p>Prima <img src="legacy.png" alt="legacy layout"> Dopo</p>'} onEditorReady={fn => { getHtml = fn; }} />);
    const image = await screen.findByAltText('legacy layout');
    const container = image.closest('.editor-image-node') as HTMLElement;
    expect(container.dataset.layout).toBe('inline');
    const parsed = () => new DOMParser().parseFromString(getHtml!(), 'text/html');
    expect(parsed().querySelector('p')?.textContent).toBe('Prima  Dopo');
    expect(parsed().querySelector('p > [data-editor-image]')).toBeTruthy();
    await act(async () => { fireEvent.mouseDown(image); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Wrap' })); });
    expect(container.dataset.layout).toBe('wrap');
    const surface = container.querySelector<HTMLElement>('.editor-image-surface')!;
    surface.style.left = '206px';
    surface.style.top = '28px';
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'In-line' })); });
    expect(container.dataset.layout).toBe('inline');
    expect(surface.style.left).toBe('0px');
    expect(surface.style.top).toBe('0px');
    expect(parsed().querySelector('p')?.textContent).toBe('Prima  Dopo');
  });

  it('clamps invalid imported position and width before rendering and serializing', async () => {
    let getHtml: (() => string) | undefined;
    render(<RichTextEditor initialContent={'<div data-editor-image data-layout="unknown" data-align="unknown" data-position="900" data-width="-900"><img src="invalid.png" alt="invalid layout"></div>'} onEditorReady={fn => { getHtml = fn; }} />);
    const image = await screen.findByAltText('invalid layout');
    expect(image.closest('.editor-image-node')?.getAttribute('data-width')).toBe('20');
    expect(getHtml!()).toContain('data-position="100"');
    expect(getHtml!()).toContain('data-layout="inline"');
  });
  it('preserves stretched image dimensions and resize offsets through copy and reopening', async () => {
    let getHtml: (() => string) | undefined;
    const { unmount } = render(<RichTextEditor initialContent={'<p>Prima <span data-editor-image data-layout="inline" data-width="35" data-aspect-ratio="2.5" data-offset-x="-25" data-offset-y="-30"><img src="stretch.png" alt="Stretched"></span> Dopo</p>'} onEditorReady={fn => { getHtml = fn; }} />);
    const image = await screen.findByAltText('Stretched');
    expect(Number.parseFloat(image.style.aspectRatio)).toBe(2.5);
    expect(new DOMParser().parseFromString(getHtml!(), 'text/html').querySelector('img')?.getAttribute('height')).toBe('89');
    const html = normalizePreviewHtmlContent(await prepareHtmlForClipboard(getHtml!()));
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const asset = parsed.querySelector('img')!;
    expect(asset.getAttribute('height')).toBe('89');
    expect(Number.parseFloat(asset.style.aspectRatio)).toBe(2.5);
    expect(parsed.querySelector('[data-editor-image]')?.getAttribute('data-offset-x')).toBe('-25');
    unmount();
    render(<RichTextEditor initialContent={html} />);
    const reopened = await screen.findByAltText('Stretched');
    expect(Number.parseFloat(reopened.style.aspectRatio)).toBe(2.5);
    expect((reopened.closest('.editor-image-node') as HTMLElement).style.top).toBe('-30px');
    expect((reopened.closest('.editor-image-node') as HTMLElement).style.marginLeft).toBe('-25px');
  });
  it.each(['inline', 'wrap'])('preserves oversized %s images through saved HTML, copy and reopening', async layout => {
    let getHtml: (() => string) | undefined;
    const { unmount } = render(<RichTextEditor initialContent={`<p><span data-editor-image data-layout="${layout}" data-width="125.5" data-aspect-ratio="2" data-offset-x="-180"><img src="oversized.png" alt="Oversized"></span> Dopo</p>`} onEditorReady={fn => { getHtml = fn; }} />);
    const anchor = (await screen.findByAltText('Oversized')).closest('.editor-image-node') as HTMLElement;
    expect(anchor.dataset.width).toBe('125.5');
    expect(anchor.style.maxWidth).toBe('none');
    const saved = getHtml!();
    expect(saved).toContain('data-width="125.5"');
    const html = normalizePreviewHtmlContent(await prepareHtmlForClipboard(saved));
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector('img')!.getAttribute('width')).toBe('796');
    expect(parsed.querySelector('img')!.getAttribute('height')).toBe('398');
    const previewWithoutWidth = normalizePreviewHtmlContent(saved.replace(/ width="\d+"/, ''));
    expect(new DOMParser().parseFromString(previewWithoutWidth, 'text/html').querySelector('img')!.getAttribute('width')).toBe('796');
    unmount();
    render(<RichTextEditor initialContent={html} />);
    const reopened = (await screen.findByAltText('Oversized')).closest('.editor-image-node') as HTMLElement;
    expect(reopened.dataset.width).toBe('125.5');
    expect(reopened.dataset.offsetX).toBe('-180');
    expect(reopened.dataset.aspectRatio).toBe('2');
  });
  it.each([
    '<div data-editor-image="true" data-width="56"><img src="caption.png" alt="caption test"><figcaption class="editor-image-caption">Figura 1: schema &amp; formula</figcaption></div>',
    '<div data-editor-image="true" data-width="56" data-caption="Figura 1: schema &amp; formula"><img src="caption.png" alt="caption test"></div>',
  ])('preserves an imported caption when the editor serializes %s', async htmlContent => {
    let getHtml: (() => string) | undefined;
    render(<RichTextEditor initialContent={htmlContent} onEditorReady={fn => { getHtml = fn; }} />);

    await screen.findByAltText('caption test');
    const serialized = new DOMParser().parseFromString(getHtml!(), 'text/html');
    const image = serialized.querySelector('[data-editor-image]');
    expect(image?.getAttribute('data-caption')).toBe('Figura 1: schema & formula');
    expect(image?.querySelector('.editor-image-caption')?.textContent).toBe('Figura 1: schema & formula');
  });

  it('selects image node on mousedown and renders selection handles', async () => {
    const htmlContent = '<div data-editor-image="true" data-width="56"><img src="test.png" alt="test image" /></div>';
    render(<RichTextEditor initialContent={htmlContent} />);

    const imgEl = await screen.findByAltText('test image');
    expect(imgEl).toBeTruthy();

    const imageContainer = imgEl.closest('.editor-image-node');
    expect(imageContainer).toBeTruthy();

    act(() => {
      fireEvent.mouseDown(imgEl);
    });

    await waitFor(() => expect(imageContainer?.classList.contains('is-selected')).toBe(true));
    const handlesContainer = imageContainer?.querySelector('.editor-image-resize-handles');
    expect(handlesContainer).toBeTruthy();
    expect(handlesContainer?.querySelectorAll('.editor-image-resize-handle')).toHaveLength(8);
  });

  it('selects image node on pointerDown as fallback', async () => {
    const htmlContent = '<div data-editor-image="true" data-width="56"><img src="test2.png" alt="test image 2" /></div>';
    render(<RichTextEditor initialContent={htmlContent} />);

    const imgEl = await screen.findByAltText('test image 2');
    const imageContainer = imgEl.closest('.editor-image-node');

    act(() => {
      fireEvent.pointerDown(imgEl);
    });

    await waitFor(() => expect(imageContainer?.classList.contains('is-selected')).toBe(true));
  });

  it('calculates clipboard image pixel width from percentage', async () => {
    let getHtmlFn: (() => string) | undefined;
    const htmlContent = '<div data-editor-image="true" data-width="35"><img src="test3.png" alt="test image 3" /></div>';

    render(<RichTextEditor initialContent={htmlContent} onEditorReady={fn => { getHtmlFn = fn; }} />);

    await screen.findByAltText('test image 3');
    expect(getHtmlFn).toBeDefined();
    const serializedHtml = getHtmlFn!();
    expect(serializedHtml).toContain('width="222"');
    expect(serializedHtml).toContain('data-width="35"');
    expect(serializedHtml).toMatch(/width:\s*222px/);
  });

  it('parses pixel width attribute when data-width is absent', async () => {
    let getHtmlFn: (() => string) | undefined;
    const htmlContent = '<img src="test4.png" alt="test image 4" width="317" />';

    render(<RichTextEditor initialContent={htmlContent} onEditorReady={fn => { getHtmlFn = fn; }} />);

    await screen.findByAltText('test image 4');
    expect(getHtmlFn).toBeDefined();
    const serializedHtml = getHtmlFn!();
    expect(serializedHtml).toContain('data-width="50"');
    expect(serializedHtml).toContain('width="317"');
  });
});
