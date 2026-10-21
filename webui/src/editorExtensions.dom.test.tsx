import { describe, it, expect, vi } from 'vitest';
import katex from 'katex';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { escapeHtml, extractHeadings, MathInline, MathBlock } from './editorExtensions';

describe('extractHeadings', () => {
  it('reads top-level headings from the document with ids that survive blocks inserted above', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<h2>Capitolo</h2><p>Testo</p><h3>Dettagli <strong>chiave</strong></h3><h2>Capitolo</h2><h2>   </h2><blockquote><h2>Citato</h2></blockquote>' });
    try {
      const getJSON = vi.spyOn(editor, 'getJSON');
      const before = extractHeadings(editor);
      expect(before.map(({ level, text }) => [level, text])).toEqual([[2, 'Capitolo'], [3, 'Dettagli chiave'], [2, 'Capitolo']]);
      expect(new Set(before.map(h => h.id)).size).toBe(3);
      expect(getJSON).not.toHaveBeenCalled();

      editor.commands.insertContentAt(0, '<p>Nuova introduzione</p><h4>Premessa</h4>');
      const after = extractHeadings(editor);
      expect(after.slice(1)).toEqual(before);
    } finally { editor.destroy(); }
  });
});

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and single quotes', () => {
    const raw = '<img src="x" onerror=\'alert(1)\'> & test';
    const escaped = escapeHtml(raw);
    expect(escaped).toBe('&lt;img src=&quot;x&quot; onerror=&#039;alert(1)&#039;&gt; &amp; test');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('safely handles null, undefined, or non-string inputs', () => {
    expect(escapeHtml(null as unknown as string)).toBe('');
    expect(escapeHtml(undefined as unknown as string)).toBe('');
    expect(escapeHtml(123 as unknown as string)).toBe('123');
  });
});

describe('Math nodes KaTeX fallback escaping', () => {
  it('escapes latex in MathInline.renderHTML fallback when katex throws', () => {
    const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('KaTeX parser failure');
    });

    const maliciousLatex = '<img src=x onerror=alert("xss")>';
    const renderFn = MathInline.config.renderHTML as unknown as (props: { HTMLAttributes: Record<string, unknown> }) => unknown;
    const rendered = renderFn({
      HTMLAttributes: { latex: maliciousLatex },
    });

    spy.mockRestore();

    expect(rendered).toBeDefined();
    const innerSpan = (rendered as [string, Record<string, unknown>, HTMLElement])[2];
    expect(innerSpan.querySelector('img')).toBeNull();
    expect(innerSpan.innerHTML).toContain('&lt;img');
    expect(innerSpan.textContent).toBe(maliciousLatex);
  });

  it('escapes latex in MathBlock.renderHTML fallback when katex throws', () => {
    const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('KaTeX parser failure');
    });

    const maliciousLatex = '<script>alert("xss")</script>';
    const renderBlockFn = MathBlock.config.renderHTML as unknown as (props: { HTMLAttributes: Record<string, unknown> }) => unknown;
    const rendered = renderBlockFn({
      HTMLAttributes: { latex: maliciousLatex },
    });

    spy.mockRestore();

    expect(rendered).toBeDefined();
    const innerDiv = (rendered as [string, Record<string, unknown>, HTMLElement])[2];
    expect(innerDiv.querySelector('script')).toBeNull();
    expect(innerDiv.innerHTML).toContain('&lt;script');
    expect(innerDiv.textContent).toBe(maliciousLatex);
  });
});
