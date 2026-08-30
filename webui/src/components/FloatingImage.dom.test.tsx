import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

describe('FloatingImage selection and resize handles', () => {
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

    expect(imageContainer?.classList.contains('is-selected')).toBe(true);
    const handlesContainer = imageContainer?.querySelector('.gdocs-handles-container');
    expect(handlesContainer).toBeTruthy();
    expect(handlesContainer?.querySelectorAll('.gdocs-handle')).toHaveLength(8);
  });

  it('selects image node on pointerDown as fallback', async () => {
    const htmlContent = '<div data-editor-image="true" data-width="56"><img src="test2.png" alt="test image 2" /></div>';
    render(<RichTextEditor initialContent={htmlContent} />);

    const imgEl = await screen.findByAltText('test image 2');
    const imageContainer = imgEl.closest('.editor-image-node');

    act(() => {
      fireEvent.pointerDown(imgEl);
    });

    expect(imageContainer?.classList.contains('is-selected')).toBe(true);
  });

  it('correctly calculates pixel width for Google Docs based on percentage', async () => {
    let getHtmlFn: (() => string) | undefined;
    const htmlContent = '<div data-editor-image="true" data-width="35"><img src="test3.png" alt="test image 3" /></div>';

    render(<RichTextEditor initialContent={htmlContent} onEditorReady={fn => { getHtmlFn = fn; }} />);

    await screen.findByAltText('test image 3');
    expect(getHtmlFn).toBeDefined();
    const serializedHtml = getHtmlFn!();
    expect(serializedHtml).toContain('width="222"');
    expect(serializedHtml).toContain('data-width="35"');
    expect(serializedHtml).toMatch(/width:\s*35%/);
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
