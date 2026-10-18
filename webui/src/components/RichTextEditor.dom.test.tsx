import React from 'react';
import type { Editor } from '@tiptap/core';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
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

  it('keeps the index mounted for its exit fade and restores it on immediate reopen', () => {
    const onTocToggle = vi.fn();
    const onScrollToHeading = vi.fn();
    const heading = { id: 'h-0', level: 2, text: 'Capitolo indice' };
    const props = {
      initialContent: '<p>Appunti</p>',
      tocHeadings: [heading],
      onTocToggle,
      onScrollToHeading,
    };
    const { rerender } = render(<RichTextEditor {...props} isTocOpen />);
    const navigation = screen.getByRole('navigation');
    const headingButton = screen.getByRole('button', { name: heading.text });
    const content = navigation.parentElement!;
    const trigger = screen.getByTitle('Apri indice').parentElement!;
    expect(trigger.hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByTitle('Chiudi'));
    expect(onTocToggle).toHaveBeenCalledOnce();
    rerender(<RichTextEditor {...props} isTocOpen={false} />);

    expect(navigation.isConnected).toBe(true);
    expect(headingButton.isConnected).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('true');
    expect(content.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(trigger.hasAttribute('inert')).toBe(false);

    rerender(<RichTextEditor {...props} isTocOpen />);
    expect(screen.getByRole('navigation')).toBe(navigation);
    expect(content.hasAttribute('inert')).toBe(false);
    expect(content.getAttribute('aria-hidden')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: heading.text }));
    expect(onScrollToHeading).toHaveBeenCalledWith(heading);
    expect(trigger.hasAttribute('inert')).toBe(true);
  });

  it('preserves local edits through toolbar undo and redo', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialContent="<p>Appunti originali</p>" onChange={onChange} />);
    const element = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
    await waitFor(() => expect(element.editor).toBeTruthy());

    act(() => element.editor.commands.insertContentAt(element.editor.state.doc.content.size - 1, ' corretti'));
    expect(element.textContent).toBe('Appunti originali corretti');
    expect(onChange).toHaveBeenLastCalledWith('<p>Appunti originali corretti</p>');

    act(() => fireEvent.click(screen.getByTitle('Annulla (Ctrl+Z)')));
    expect(element.textContent).toBe('Appunti originali');
    expect(onChange).toHaveBeenLastCalledWith('<p>Appunti originali</p>');

    act(() => fireEvent.click(screen.getByTitle('Ripeti (Ctrl+Y)')));
    expect(element.textContent).toBe('Appunti originali corretti');
    expect(onChange).toHaveBeenLastCalledWith('<p>Appunti originali corretti</p>');
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

  it('preserves and correctly parses HTML tables without flattening cells', async () => {
    let getHtmlFn: (() => string) | null = null;
    const onEditorReady = vi.fn((getHtml: () => string) => {
      getHtmlFn = getHtml;
    });

    const tableHtml = '<table><thead><tr><th>ID Soggetto</th><th>Sesso</th><th>Età</th></tr></thead><tbody><tr><td>001</td><td>Maschio</td><td>45</td></tr></tbody></table>';

    render(
      <RichTextEditor
        initialContent={tableHtml}
        onEditorReady={onEditorReady}
      />
    );

    await waitFor(() => expect(onEditorReady).toHaveBeenCalled());
    expect(getHtmlFn).toBeTruthy();

    const outputHtml = getHtmlFn!();
    expect(outputHtml).toContain('<table');
    expect(outputHtml).toContain('ID Soggetto');
    expect(outputHtml).toContain('Maschio');
    expect(outputHtml).not.toContain('IDSoggettoSessoEtà');
  });

  it('opens the shared link panel with Ctrl+K and links a selection or inserts a link at the caret', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    render(<RichTextEditor initialContent="<p>Vedi appunti</p>" />);
    const element = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
    await waitFor(() => expect(element.editor).toBeTruthy());
    act(() => { element.editor.commands.setTextSelection({ from: 1, to: 5 }); });
    const ctrlK = () => act(() => { fireEvent.keyDown(element, { key: 'k', ctrlKey: true }); });
    ctrlK();
    const input = await screen.findByPlaceholderText('https://...');
    fireEvent.change(input, { target: { value: 'example.com' } });
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(element.editor.getHTML()).toContain('<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">Vedi</a>');

    // A caret inside the link edits the whole link rather than removing it.
    act(() => { element.editor.commands.setTextSelection(3); });
    ctrlK();
    const editInput = await screen.findByPlaceholderText('https://...');
    expect((editInput as HTMLInputElement).value).toBe('https://example.com');
    fireEvent.change(editInput, { target: { value: 'https://docs.example.com' } });
    act(() => { fireEvent.keyDown(editInput, { key: 'Enter' }); });
    expect(element.editor.getHTML()).toContain('href="https://docs.example.com">Vedi</a> appunti');

    // A caret outside a link inserts the address as linked text.
    act(() => { element.editor.commands.setTextSelection(element.editor.state.doc.content.size - 1); });
    ctrlK();
    const insertInput = await screen.findByPlaceholderText('https://...');
    fireEvent.change(insertInput, { target: { value: 'https://a.it' } });
    act(() => { fireEvent.keyDown(insertInput, { key: 'Enter' }); });
    expect(element.editor.getHTML()).toContain('appunti<a target="_blank" rel="noopener noreferrer nofollow" href="https://a.it">https://a.it</a>');
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('opens the link panel from the context menu without a native prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    render(<RichTextEditor initialContent="<p>Vedi appunti</p>" />);
    const element = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
    await waitFor(() => expect(element.editor).toBeTruthy());
    act(() => { element.editor.commands.setTextSelection({ from: 1, to: 5 }); });
    fireEvent.contextMenu(element, { clientX: 40, clientY: 40 });
    act(() => { fireEvent.click(within(document.querySelector('.editor-context-menu') as HTMLElement).getByRole('button', { name: /Inserisci link/ })); });
    const input = await screen.findByPlaceholderText('https://...');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(element.editor.getHTML()).toContain('href="https://example.com">Vedi</a>');
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });
});
