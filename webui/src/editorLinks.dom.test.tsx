import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { RichTextEditor } from './components/RichTextEditor';
import { videoLink, youtubeVideoId } from './editorLinks';

const editorOf = () => (document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor }).editor;
const caretIn = (editor: Editor, text: string) => {
  let at = 0;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text?.includes(text)) at = pos + node.text.indexOf(text) + 2; });
  editor.commands.focus();
  editor.commands.setTextSelection(at);
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { pywebview?: unknown }).pywebview;
});

describe('YouTube addresses', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?controls=1', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/abcDEF_123', 'abcDEF_123'],
    ['https://example.com/watch?v=dQw4w9WgXcQ', null],
    ['javascript:alert(1)', null],
  ])('reads the video id of %s', (href, id) => {
    expect(youtubeVideoId(href)).toBe(id);
  });

  it('turns an embed address into its public watch page', () => {
    expect(videoLink('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('Docs-style links and videos in the editor', () => {
  it('opens saved and pasted players as the linked address Docs receives', async () => {
    let getHtml: (() => string) | undefined;
    render(<RichTextEditor
      initialContent={'<p>Prima</p><div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></div><p>Dopo</p>'}
      onEditorReady={fn => { getHtml = fn; }}
    />);
    await screen.findByText('Prima');
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(editorOf().getJSON().content![1]).toMatchObject({ type: 'paragraph', content: [{ text: url, marks: [{ type: 'link', attrs: { href: url } }] }] });
    expect(getHtml!()).not.toContain('iframe');
    act(() => { editorOf().commands.setContent('<p>Testo</p><iframe src="https://www.youtube.com/embed/abcDEF_123"></iframe><iframe src="/locale.html"></iframe>'); });
    expect(editorOf().getText()).toContain('https://www.youtube.com/watch?v=abcDEF_123');
    expect(editorOf().getHTML()).not.toContain('locale.html');
  });

  it('drops pasted embeds that are not videos, such as ads and maps', async () => {
    render(<RichTextEditor initialContent="<p>Prima</p>" />);
    await screen.findByText('Prima');
    act(() => {
      editorOf().commands.setContent('<p>Articolo</p><iframe src="https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-1"></iframe><iframe src="https://www.google.com/maps/embed?pb=!1m18"></iframe><iframe src="https://player.vimeo.com/video/123"></iframe><p>Fine</p>');
    });
    expect(editorOf().getText()).toBe('Articolo\n\nhttps://vimeo.com/123\n\nFine');
    expect(editorOf().getHTML()).not.toMatch(/doubleclick|maps/);
  });

  it('shows the link card at the caret and previews, copies, edits and removes the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const openLink = vi.fn().mockResolvedValue({ ok: true });
    (window as { pywebview?: unknown }).pywebview = { api: { open_link: openLink } };
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    render(<RichTextEditor initialContent={`<p>Guarda <a href="${url}">il video</a> e poi <a href="https://example.com">il sito</a>.</p>`} />);
    await screen.findByText('il video');
    act(() => caretIn(editorOf(), 'il video'));
    const card = await screen.findByRole('dialog', { name: 'Link' });
    expect(card.textContent).toContain(url);

    fireEvent.click(screen.getByTitle('Apri il link'));
    expect(openLink).toHaveBeenCalledWith(url);
    fireEvent.click(screen.getByRole('button', { name: 'Copia link' }));
    expect(writeText).toHaveBeenCalledWith(url);

    // YouTube plays in a floating window; the document stays unchanged.
    const before = editorOf().getJSON();
    fireEvent.click(screen.getByRole('button', { name: 'Anteprima video' }));
    const player = (await screen.findByRole('dialog', { name: 'Anteprima video' })).querySelector('iframe')!;
    expect(player.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
    expect(editorOf().getJSON()).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi anteprima' }));
    expect(screen.queryByRole('dialog', { name: 'Anteprima video' })).toBeNull();

    // Other links have no preview.
    act(() => caretIn(editorOf(), 'il sito'));
    expect(screen.queryByRole('button', { name: 'Anteprima video' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Modifica link' }));
    expect((await screen.findByPlaceholderText('https://...') as HTMLInputElement).value).toBe('https://example.com');
    act(() => caretIn(editorOf(), 'il sito'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rimuovi link' }));
    expect(editorOf().getHTML()).not.toContain('example.com');
    expect(editorOf().getHTML()).toContain(url);
    expect(screen.queryByRole('dialog', { name: 'Link' })).toBeNull();
    act(() => { editorOf().commands.undo(); });
    expect(editorOf().getHTML()).toContain('href="https://example.com"');
  });

  it('inserts a Ctrl+K address at the caret and keeps the text typed next outside the link', async () => {
    render(<RichTextEditor initialContent="<p>Vedi qui.</p>" />);
    await screen.findByText('Vedi qui.');
    act(() => caretIn(editorOf(), 'di qui'));
    fireEvent.keyDown(editorOf().view.dom, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText('https://...');
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // A typed character inherits the stored marks, as real typing does.
    act(() => { const { view } = editorOf(); view.dispatch(view.state.tr.insertText(' dopo')); });
    expect(editorOf().getJSON().content![0].content).toEqual([
      { type: 'text', text: 'Vedi' },
      { type: 'text', text: 'https://example.com', marks: [{ type: 'link', attrs: expect.objectContaining({ href: 'https://example.com' }) }] },
      { type: 'text', text: ' dopo qui.' },
    ]);
  });

  it('opens a link with Ctrl+click and leaves a plain click for editing', async () => {
    const openLink = vi.fn().mockResolvedValue({ ok: true });
    (window as { pywebview?: unknown }).pywebview = { api: { open_link: openLink } };
    render(<RichTextEditor initialContent={'<p>Vai su <a href="https://example.com/pagina">questa pagina</a>.</p>'} />);
    const link = await screen.findByText('questa pagina');
    fireEvent.click(link);
    expect(openLink).not.toHaveBeenCalled();
    fireEvent.click(link, { ctrlKey: true });
    expect(openLink).toHaveBeenCalledWith('https://example.com/pagina');
  });
});
