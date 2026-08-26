import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

describe('RichTextEditor Component', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the editor container and initial content', async () => {
    const onEditorReady = vi.fn();
    const onChange = vi.fn();

    render(
      <RichTextEditor
        initialContent="<p>Prima pagina di appunti per anatomia</p>"
        onEditorReady={onEditorReady}
        onChange={onChange}
      />
    );

    const editorEl = document.querySelector('.tiptap-editor');
    expect(editorEl).toBeTruthy();

    // Verify initial content rendered
    expect(screen.getByText('Prima pagina di appunti per anatomia')).toBeTruthy();

    // Verify onEditorReady callback provided getHtml function
    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    const getHtmlFn = onEditorReady.mock.calls[0][0];
    const html = getHtmlFn();
    expect(html).toContain('Prima pagina di appunti per anatomia');
  });

  it('renders table of contents sidebar toggle and responds to zoom', () => {
    const onTocToggle = vi.fn();

    const { rerender } = render(
      <RichTextEditor
        initialContent="<h2>Capitolo 1: Ossa del Cranio</h2><p>Dettagli capitolo...</p>"
        isTocOpen={false}
        onTocToggle={onTocToggle}
        zoomLevel={100}
      />
    );

    const tocBtn = screen.getByTitle('Apri indice');
    expect(tocBtn).toBeTruthy();

    const pageWrapper = document.querySelector('.editor-page') as HTMLElement;
    expect(pageWrapper).toBeTruthy();
    expect(pageWrapper.style.zoom).toBe('1');

    rerender(
      <RichTextEditor
        initialContent="<h2>Capitolo 1: Ossa del Cranio</h2><p>Dettagli capitolo...</p>"
        isTocOpen={false}
        onTocToggle={onTocToggle}
        zoomLevel={150}
      />
    );

    expect(pageWrapper.style.zoom).toBe('1.5');
  });

  it('extracts headings and triggers onHeadingsChange', async () => {
    const onHeadingsChange = vi.fn();

    render(
      <RichTextEditor
        initialContent="<h2>Titolo Sezione 1</h2><p>Paragrafo</p><h3>Sotto Sezione</h3>"
        onHeadingsChange={onHeadingsChange}
      />
    );

    await waitFor(() => expect(onHeadingsChange).toHaveBeenCalled());
    const headings = onHeadingsChange.mock.calls[0][0];
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(headings.some((h: { text: string }) => h.text === 'Titolo Sezione 1')).toBe(true);
  });

  it('removes inline fontSize mark when setting a heading on text with pre-existing font-size', async () => {
    let getHtmlFn: (() => string) | null = null;
    const onEditorReady = vi.fn((getHtml: () => string) => {
      getHtmlFn = getHtml;
    });

    render(
      <RichTextEditor
        initialContent='<p><span style="font-size: 11pt">Titolo con dimensione inline</span></p>'
        onEditorReady={onEditorReady}
      />
    );

    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    expect(getHtmlFn).toBeTruthy();

    const headingDropdownBtn = screen.getByTitle('Stile paragrafo');
    expect(headingDropdownBtn).toBeTruthy();

    // The initial content has fontSize 11pt mark on span
    expect(getHtmlFn!()).toContain('font-size: 11pt');

    // Click heading dropdown and select Titolo 1
    act(() => {
      fireEvent.click(headingDropdownBtn);
    });
    const h1Option = await screen.findByRole('button', { name: 'Titolo 1' });
    act(() => {
      fireEvent.click(h1Option);
    });

    // Verify the output HTML is an h1 without inline font-size span
    await waitFor(() => {
      const html = getHtmlFn!();
      expect(html).toContain('<h1>');
      expect(html).not.toContain('font-size: 11pt');
      expect(html).toContain('Titolo con dimensione inline');
    });
  });
});
