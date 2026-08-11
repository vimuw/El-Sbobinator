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
});
