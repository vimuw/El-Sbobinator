import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { RichTextEditor } from './components/RichTextEditor';
import { getSearchMatches } from './editorExtensions';
import { NATIVE_SLICE_MIME } from './editorClipboard';
import { pasteEditorClipboard } from './editorSelectionClipboard';
import { EditorContextMenu } from './components/EditorContextMenu';
import { normalizePreviewHtmlContent } from './previewHtml';

async function openEditor(content: string) {
  render(<RichTextEditor initialContent={content} />);
  const element = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(element.editor).toBeTruthy());
  return { element, editor: element.editor };
}

function transfer(element: HTMLElement, type: 'copy' | 'cut') {
  const formats: Record<string, string> = {};
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    setData: (mime: string, text: string) => { formats[mime] = text; },
    clearData: () => { Object.keys(formats).forEach(mime => { delete formats[mime]; }); },
  } });
  act(() => { element.dispatchEvent(event); });
  return { formats, event };
}

describe('Editor parity: clipboard and logical text', () => {
  it('imports Docs span highlights as editable marks while retaining black and custom foreground colors', async () => {
    const { editor } = await openEditor('<p></p>');
    act(() => { editor.view.pasteHTML('<b id="docs-internal-guid-test"><p><span style="color:#000000;background-color:#fef08a;font-size:11pt">Giallo nero</span> <span style="background-color:#fef08a"><span style="color:#123abc">Giallo blu</span></span><span style="background-color:transparent">Normale</span></p></b>', new Event('paste') as ClipboardEvent); });
    const text = (label: string) => (editor.getJSON() as JSONContent).content![0].content!.find(node => node.text === label)!;
    expect(text('Giallo nero').marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'highlight', attrs: { color: 'rgb(254, 240, 138)' } }), expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: 'rgb(0, 0, 0)', fontSize: '11pt' }) })]));
    expect(text('Giallo blu').marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'highlight' }), expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: '#123abc' }) })]));
    expect(text('Normale').marks?.some(mark => mark.type === 'highlight')).toBeFalsy();
    const saved = editor.getHTML(); act(() => { editor.commands.setContent(normalizePreviewHtmlContent(saved)); });
    expect(editor.getHTML()).toContain('<mark');
  });

  it.each([1, 2, 3, 4, 5, 6].flatMap(level => [false, true].map(reverse => ({ level, reverse }))))('pastes a complete H$level as a heading only when replacing a normal paragraph (reverse=$reverse)', async ({ level, reverse }) => {
    const { editor, element } = await openEditor(`<h${level}>Titolo</h${level}><p></p>`);
    act(() => { editor.commands.setTextSelection(reverse ? { from: 7, to: 1 } : { from: 1, to: 7 }); });
    const formats = transfer(element, 'copy').formats;
    expect(formats['text/html']).toContain(`data-editor-selection-heading="1"`);
    const native = JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved;
    expect(native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean)).toEqual(expect.arrayContaining([expect.objectContaining({ ps_hd: level })]));
    for (const target of ['<p></p>', '<p>Vecchio</p>', '<p>Prima dopo</p>', '<ul><li><p></p></li></ul>']) {
      act(() => {
        editor.commands.setContent(target);
        editor.commands.setTextSelection(target.includes('Vecchio') ? { from: 1, to: 8 } : target.includes('Prima') ? 7 : target.includes('<ul>') ? 3 : 1);
        editor.view.pasteHTML(formats['text/html'], new Event('paste') as ClipboardEvent);
      });
      const root = (editor.getJSON() as JSONContent).content!;
      if (target.includes('Prima')) {
        expect(root).toHaveLength(1); expect(root[0].type).toBe('paragraph'); expect(editor.getText()).toBe('Prima Titolodopo');
      } else if (target.includes('<ul>')) {
        expect(root[0].type).toBe('bulletList'); expect(root[0].content![0].content![0].type).toBe('paragraph');
      } else expect(root[0]).toMatchObject({ type: 'heading', attrs: { level } });
      expect(editor.getHTML()).not.toMatch(/data-editor-(selection-heading|default-heading-color)/);
      expect(editor.getHTML()).not.toContain('color: rgb(0, 0, 0)');
      const saved = editor.getJSON();
      act(() => { editor.commands.setContent(normalizePreviewHtmlContent(editor.getHTML())); });
      expect(editor.getJSON()).toEqual(saved);
    }
  });

  it('keeps a partial default heading inline without turning its default ink into authored black', async () => {
    const { editor, element } = await openEditor('<h2>Prima scelta dopo</h2>');
    act(() => { editor.commands.setTextSelection({ from: 7, to: 13 }); });
    const formats = transfer(element, 'copy').formats;
    expect(formats['text/html']).toContain('data-editor-default-heading-color');
    act(() => { editor.commands.setContent('<p></p>'); editor.commands.setTextSelection(1); editor.view.pasteHTML(formats['text/html'], new Event('paste') as ClipboardEvent); });
    expect(editor.getJSON().content![0].type).toBe('paragraph');
    expect(editor.getText()).toBe('scelta');
    expect(editor.getHTML()).not.toContain('color: rgb(0, 0, 0)');
    expect(editor.getHTML()).toContain('font-size: 16pt');
  });

  it.each(['heading', 'paragraph'])('clears inherited and inline ink in a partial $0 selection without changing layout or surrounding colors', async type => {
    const tag = type === 'heading' ? 'h2' : 'p';
    const { editor } = await openEditor(`<${tag} style="color:#123abc;font-family:Georgia;margin-top:8pt;line-height:1.8">Prima <span style="color:red;font-size:18pt"><em>scelta</em></span> dopo</${tag}><p></p>`);
    const original = editor.getJSON();
    act(() => { editor.commands.setTextSelection({ from: 7, to: 13 }); editor.commands.clearDocumentColor(); });
    const block = editor.getJSON().content![0] as JSONContent;
    expect(block.type).toBe(type);
    expect(block.attrs!.documentStyle).toMatchObject({ 'font-family': 'Georgia', 'margin-top': '8pt', 'line-height': '1.8' });
    expect(block.attrs!.documentStyle.color).toBeUndefined();
    for (const text of ['Prima ', ' dopo']) expect(block.content!.find(node => node.text === text)?.marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: 'rgb(18, 58, 188)' }) })]));
    expect(block.content!.find(node => node.text === 'scelta')?.marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: null, fontSize: '18pt' }) }), expect.objectContaining({ type: 'italic' })]));
    act(() => { editor.commands.undo(); }); expect(editor.getJSON()).toEqual(original);
  });

  it('clears future ink at a caret while preserving existing text, marks, and inherited color', async () => {
    const { editor } = await openEditor('<h2 style="color:#123abc;margin-top:8pt"><em>Prima dopo</em></h2><p></p>');
    const original = editor.getJSON();
    act(() => { editor.commands.setTextSelection(7); editor.commands.clearDocumentColor(); editor.commands.insertContent('X'); });
    const block = editor.getJSON().content![0] as JSONContent;
    expect(block.attrs!.documentStyle).toEqual({ 'margin-top': '8pt' });
    expect(block.content!.find(node => node.text === 'X')?.marks).toEqual([{ type: 'italic' }]);
    for (const label of ['Prima ', 'dopo']) expect(block.content!.find(node => node.text === label)?.marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: 'rgb(18, 58, 188)' }) })]));
    act(() => { editor.commands.undo(); editor.commands.undo(); }); expect(editor.getJSON()).toEqual(original);
  });

  it('clears color across blocks without clearing links, highlights or other typography and keeps can() read-only', async () => {
    const { editor } = await openEditor('<h2 style="color:#123abc;font-family:Georgia">Prima</h2><p style="color:red;margin-top:8pt"><a href="https://example.com"><mark style="background-color:yellow"><em>Seconda</em></mark></a></p>');
    act(() => { editor.commands.selectAll(); });
    const original = editor.getJSON();
    expect(editor.can().clearDocumentColor()).toBe(true); expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.clearDocumentColor(); });
    expect(editor.getHTML()).not.toMatch(/color: (rgb|red)/);
    expect(editor.getHTML()).toContain('font-family: Georgia'); expect(editor.getHTML()).toContain('margin-top: 8pt');
    expect(editor.getHTML()).toContain('href="https://example.com"'); expect(editor.getHTML()).toContain('<mark'); expect(editor.getHTML()).toContain('<em>');
    act(() => { editor.commands.undo(); }); expect(editor.getJSON()).toEqual(original);
  });

  it.each([
    { shape: 'row', last: 2, selected: [0, 1, 2] },
    { shape: 'column', last: 6, selected: [0, 3, 6] },
    { shape: 'rectangle', last: 4, selected: [0, 1, 3, 4] },
  ].flatMap(selection => [false, true].map(reverse => ({ ...selection, reverse }))))('clears all selected table cells in a $shape (reverse=$reverse), preserving excluded cells and undo', async ({ last, selected, reverse }) => {
    const emptyMarks = JSON.stringify([{ type: 'textStyle', attrs: { color: 'red', fontFamily: 'Georgia' } }, { type: 'italic' }]);
    const cells = Array.from({ length: 9 }, (_, index) => `<td><p style="color:#123abc;margin-top:8pt;line-height:1.8">${index}<span style="color:red;font-size:18pt"><em>scelta</em></span></p><h2 data-editor-empty-marks='${emptyMarks}'></h2></td>`);
    const { editor } = await openEditor(`<table><tbody>${[0, 3, 6].map(start => `<tr>${cells.slice(start, start + 3).join('')}</tr>`).join('')}</tbody></table>`);
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') positions.push(pos); });
    act(() => { editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, positions[reverse ? last : 0], positions[reverse ? 0 : last]))); });
    const original = editor.getJSON();
    const tableCells = (doc: JSONContent) => doc.content![0].content!.flatMap(row => row.content!);
    const originalCells = tableCells(original);
    expect(editor.can().clearDocumentColor()).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.chain().focus().clearDocumentColor().run(); });
    const cleared = editor.getJSON();
    tableCells(cleared).forEach((cell, index) => {
      if (!selected.includes(index)) {
        expect(cell).toEqual(originalCells[index]);
        return;
      }
      const [paragraph, emptyHeading] = cell.content!;
      expect(paragraph.attrs!.documentStyle).toEqual({ 'margin-top': '8pt', 'line-height': '1.8' });
      expect(paragraph.content![0].marks ?? []).toEqual([]);
      expect(paragraph.content![1].marks).toEqual(expect.arrayContaining([
        { type: 'italic' },
        expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: null, fontSize: '18pt' }) }),
      ]));
      expect(emptyHeading.attrs!.emptyTextMarks).toEqual([
        { type: 'textStyle', attrs: { color: null, fontFamily: 'Georgia' } }, { type: 'italic' },
      ]);
    });
    act(() => { editor.commands.undo(); }); expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.redo(); }); expect(editor.getJSON()).toEqual(cleared);
    const saved = editor.getHTML();
    act(() => { editor.commands.setContent(normalizePreviewHtmlContent(saved)); });
    expect(editor.getHTML()).toBe(saved);
  });

  it.each(['p', 'h2'].flatMap(tag => [false, true].flatMap(styled => [false, true].map(all => ({ tag, styled, all })))))('clears saved typing ink in a selected empty $tag while preserving other styles (styled=$styled, all=$all)', async ({ tag, styled, all }) => {
    const { editor } = await openEditor(`<p>Prima</p><${tag}></${tag}><p>Dopo</p><p></p>`);
    const emptyPosition = editor.state.doc.firstChild!.nodeSize + 1;
    const outsidePosition = editor.state.doc.content.size - 1;
    act(() => {
      editor.commands.setTextSelection(outsidePosition);
      editor.commands.setColor('blue');
      editor.commands.setTextSelection(emptyPosition);
      editor.commands.setColor('red');
      if (styled) editor.chain().setBold().setItalic().setFontFamily('Georgia').setFontSize('18pt').setHighlight({ color: 'yellow' }).run();
      if (all) editor.commands.selectAll();
      else editor.commands.setTextSelection({ from: 1, to: emptyPosition + 1 });
    });
    const original = editor.getJSON();
    const savedMarks = original.content![1].attrs!.emptyTextMarks;
    const expectedMarks = styled ? savedMarks.map((mark: { type: string; attrs?: Record<string, unknown> }) => mark.type === 'textStyle' ? { ...mark, attrs: { ...mark.attrs, color: null } } : mark) : null;
    expect(editor.can().clearDocumentColor()).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.clearDocumentColor(); });
    const cleared = editor.getJSON();
    expect(cleared.content![1].attrs!.emptyTextMarks).toEqual(expectedMarks);
    if (all) expect(cleared.content![3].attrs!.emptyTextMarks).toBeNull();
    else expect(cleared.content![3]).toEqual(original.content![3]);
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.redo(); });
    expect(editor.getJSON()).toEqual(cleared);
    act(() => { editor.commands.setContent(normalizePreviewHtmlContent(editor.getHTML())); });
    expect(editor.getJSON()).toEqual(cleared);
    act(() => { editor.commands.setTextSelection(emptyPosition); editor.commands.insertContent('X'); });
    const typed = (editor.getJSON() as JSONContent).content![1].content![0];
    expect(typed.text).toBe('X');
    expect(typed.marks ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: 'red' }) })]));
    if (styled) expect(typed.marks).toEqual(expect.arrayContaining([
      { type: 'bold' }, { type: 'italic' }, { type: 'highlight', attrs: { color: 'yellow' } },
      expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: null, fontFamily: 'Georgia', fontSize: '18pt' }) }),
    ]));
  });

  it('preserves the default blue of links outside a partial color reset in a colored paragraph', async () => {
    const { editor } = await openEditor('<p style="color:red"><a href="https://example.com">Link</a> scelta dopo</p>');
    const original = editor.getJSON();
    act(() => { editor.commands.setTextSelection({ from: 6, to: 12 }); editor.commands.clearDocumentColor(); });
    const link = (editor.getJSON() as JSONContent).content![0].content!.find(node => node.text === 'Link')!;
    expect(link.marks).toEqual(original.content![0].content![0].marks);
    expect(link.marks?.some(mark => mark.type === 'textStyle' && mark.attrs?.color)).toBeFalsy();
    expect(editor.getHTML()).not.toContain('style="color: red;"><a');
    act(() => { editor.commands.undo(); }); expect(editor.getJSON()).toEqual(original);
  });

  it('preserves authored whitespace in paragraphs and headings after saving and reopening', async () => {
    const { editor } = await openEditor('<h2>Titolo</h2><p>Prima</p><p></p>');
    act(() => {
      editor.commands.setTextSelection(1);
      editor.commands.insertContent('  Inizio\t');
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.insertContent(' Spazio  interno\tfinale ');
    });
    const original = editor.getJSON();
    const saved = normalizePreviewHtmlContent(editor.getHTML());
    act(() => { editor.commands.setContent(saved); });
    expect(editor.getJSON()).toEqual(original);
    const reopened = new Editor({ extensions: editor.options.extensions, content: saved });
    try {
      expect(reopened.getJSON()).toEqual(original);
    } finally {
      reopened.destroy();
    }
  });

  it('keeps generated gaps through reload and native copy but does not inherit them on Enter', async () => {
    const source = '<p>A</p><p data-generated-space-before="15.18" style="margin-top:15.18pt">B</p><ul><li><p data-generated-space-before="15.18" style="margin-top:15.18pt">Uno</p></li><li><p>Due</p></li></ul><p data-generated-space-before="15.18" style="margin-top:15.18pt">Fine</p>';
    const { editor, element } = await openEditor(source);
    const original = editor.getJSON();
    act(() => { editor.commands.setContent(normalizePreviewHtmlContent(editor.getHTML())); });
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.selectAll(); });
    const formats = transfer(element, 'copy').formats;
    const native = JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved;
    expect(native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean).map((style: { ps_sb: number }) => style.ps_sb)).toEqual([0, 15.18, 15.18, 0, 15.18]);
    const goToEnd = (text: string) => editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) editor.commands.setTextSelection(pos + node.nodeSize); });
    act(() => { goToEnd('B'); editor.commands.splitBlock(); editor.commands.insertContent('Nuovo'); });
    expect(editor.getJSON().content![2].attrs?.generatedSpaceBefore).toBeNull();
    act(() => { goToEnd('Uno'); editor.commands.splitListItem('listItem'); editor.commands.insertContent('Inserito'); });
    const list = (editor.getJSON() as JSONContent).content!.find(node => node.type === 'bulletList')!;
    expect(list.content![0].content![0].attrs?.generatedSpaceBefore).toBe(15.18);
    expect(list.content![1].content![0].attrs?.generatedSpaceBefore).toBeNull();
    act(() => { editor.commands.selectAll(); editor.commands.clearDocumentFormatting(); });
    expect(editor.getHTML()).not.toContain('data-generated-space-before');
    act(() => { editor.commands.undo(); });
    expect((editor.getHTML().match(/data-generated-space-before=/g) ?? []).length).toBe(3);
  });
  it('reopens normalized saved HTML with editable equations and explicit paragraph layout', async () => {
    const source = '<h2 style="line-height:1.6;margin-top:8pt;margin-bottom:10pt" data-document-line-spacing="1.6">Risultati</h2><p>Prima <span data-math="\\frac{x^2}{y}">formula</span> dopo.</p><div data-math-block="\\sum_{i=0}^{n}i">formula</div>';
    const { editor, element } = await openEditor(source);
    const original = editor.getJSON();
    const copy = () => {
      act(() => { editor.commands.selectAll(); });
      return JSON.parse(JSON.parse(transfer(element, 'copy').formats[NATIVE_SLICE_MIME]).data).resolved;
    };
    const before = copy();
    const saved = normalizePreviewHtmlContent(editor.getHTML());
    act(() => { editor.commands.setContent(saved); });
    expect(editor.getJSON()).toEqual(original);
    const after = copy();
    expect(after.dsl_spacers).toBe(before.dsl_spacers);
    expect(after.dsl_styleslices).toEqual(before.dsl_styleslices);
  });

  it.each(['paragraph', 'root', 'nested'].flatMap(kind => ['uniform', 'mixed', 'boundary', 'reverse-uniform', 'reverse-mixed', 'reverse-boundary', 'start', 'whole', 'reverse-start', 'reverse-whole', 'across-break', 'reverse-across-break', 'from-break', 'reverse-from-break'].map(profile => [kind, profile] as const)))('replaces a %s %s selection with the first selected character styles', async (kind, profile) => {
    const styled = (text: string) => `<span style="font-family:Georgia;font-size:18pt;color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00"><strong><em><u><s>${text}</s></u></em></strong></mark></span>`;
    const originalText = profile.endsWith('break') ? 'Pr\u000bima' : 'Prima';
    const text = profile.endsWith('uniform') ? styled('Prima') : styled(profile.endsWith('break') ? 'Pr<br>' : 'Pr') + 'ima';
    const branch = `<ol${kind === 'nested' ? ' type="a"' : ''}><li><p>${text}</p></li><li><p>Seconda</p></li></ol>`;
    const source = (kind === 'paragraph' ? `<p>${text}</p><p>Seconda</p>` : kind === 'root' ? branch : `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>`) + '<p></p>';
    const { editor, element } = await openEditor(source);
    let start = 0;
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text?.startsWith('Pr')) start = pos; });
    const from = profile.endsWith('boundary') || profile.endsWith('from-break') ? 2 : ['start', 'whole', 'reverse-start', 'reverse-whole'].includes(profile) ? 0 : 1;
    const to = profile.endsWith('whole') ? 5 : profile.endsWith('start') ? 3 : 4;
    const original = editor.getJSON();
    const expected = editor.state.doc.nodeAt(start + from)!.marks;
    act(() => { editor.commands.setTextSelection(profile.startsWith('reverse') ? { from: start + to, to: start + from } : { from: start + from, to: start + to }); });
    expect(editor.state.selection.anchor).toBe(start + (profile.startsWith('reverse') ? to : from));
    expect(editor.state.selection.head).toBe(start + (profile.startsWith('reverse') ? from : to));
    act(() => { editor.commands.setHardBreak(); editor.commands.insertContent('X'); });
    expect(editor.state.selection.$from.parentOffset).toBe(from + 2);
    expect(editor.state.doc.nodeAt(start + from)?.type.name).toBe('hardBreak');
    for (const position of [start + from, start + from + 1]) expect(editor.state.doc.nodeAt(position)?.marks).toEqual(expected);
    const saved = editor.getHTML();
    const copy = () => {
      act(() => { editor.commands.selectAll(); });
      return JSON.parse(JSON.parse(transfer(element, 'copy').formats[NATIVE_SLICE_MIME]).data).resolved;
    };
    const model = copy();
    expect(model.dsl_spacers).toContain(originalText.slice(0, from) + '\u000bX' + originalText.slice(to) + '\n');
    const slices = model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
    const at = model.dsl_spacers.indexOf('\u000b');
    const active = (index: number) => slices.slice(0, index + 1).filter(Boolean).at(-1);
    for (const index of [at, at + 1]) expect(active(index)).toMatchObject(profile.endsWith('boundary')
      ? { ts_bd: false, ts_it: false, ts_un: false, ts_st: false, ts_ff: 'Arial', ts_fs: 11, ts_fgc2: { hclr_color: '#000000' }, ts_bgc2: { hclr_color: null } }
      : { ts_bd: true, ts_it: true, ts_un: true, ts_st: true, ts_ff: 'Georgia', ts_fs: 18, ts_fgc2: { hclr_color: '#123abc' }, ts_bgc2: { hclr_color: '#ffee00' } });
    act(() => { editor.commands.undo(); }); expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.redo(); }); expect(editor.getHTML()).toBe(saved);
    act(() => { editor.commands.setContent(saved); });
    expect(copy()).toEqual(model);
  });

  it.each(['paragraph', 'root', 'nested'].flatMap(kind => [0, 2, 5].flatMap(offset => [1, 2].map(count => [kind, offset, count] as const))))('saves and copies the active styles on a %s at %s with %s soft breaks', async (kind, offset, count) => {
    const text = '<span style="font-family:Georgia;font-size:18pt;color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00"><strong><em><u><s>Prima</s></u></em></strong></mark></span>';
    const branch = `<ol><li><p>${text}</p></li><li><p>Seconda</p></li></ol>`;
    const content = kind === 'paragraph' ? `<p>${text}</p><p>Seconda</p>` : kind === 'root' ? branch : `<ol><li><p>Madre</p>${branch}</li></ol>`;
    const { editor, element } = await openEditor(content + '<p></p>');
    let start = 0;
    editor.state.doc.descendants((node, pos) => { if (node.text === 'Prima') start = pos; });
    const original = editor.getJSON();
    const marks = editor.state.doc.nodeAt(start)!.marks.map(mark => mark.toJSON());
    act(() => { editor.commands.setTextSelection(start + offset); for (let index = 0; index < count; index++) editor.commands.setHardBreak(); });
    for (let index = 0; index < count; index++) {
      expect(editor.state.doc.nodeAt(start + offset + index)?.type.name).toBe('hardBreak');
      expect(editor.state.doc.nodeAt(start + offset + index)?.marks.map(mark => mark.toJSON())).toEqual(marks);
    }
    const saved = editor.getHTML();
    act(() => { editor.commands.selectAll(); });
    const formats = transfer(element, 'copy').formats;
    const model = JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved;
    const at = model.dsl_spacers.indexOf('\u000b');
    expect(at).toBeGreaterThanOrEqual(0);
    const slices = model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
    const active = (index: number) => slices.slice(0, index + 1).filter(Boolean).at(-1);
    for (let index = 1; index < count; index++) expect(active(at + index)).toEqual(active(at));
    expect(active(at)).toMatchObject({ ts_bd: true, ts_it: true, ts_un: true, ts_st: true, ts_ff: 'Georgia', ts_fs: 18, ts_fgc2: { hclr_color: '#123abc' }, ts_bgc2: { hclr_color: '#ffee00' } });
    act(() => { editor.commands.undo(); }); expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.redo(); }); expect(editor.getHTML()).toBe(saved);
    act(() => { editor.commands.setContent(saved); });
    const normalize = (value: unknown) => JSON.stringify(value).replaceAll('#123abc', 'rgb(18, 58, 188)').replaceAll('#ffee00', 'rgb(255, 238, 0)');
    for (let index = 0; index < count; index++) expect(normalize(editor.state.doc.nodeAt(start + offset + index)?.marks.map(mark => mark.toJSON()))).toBe(normalize(marks));
  });

  it.each([false, true])('honors explicit typing marks on initial consecutive soft breaks (bold=%s)', async bold => {
    const { editor } = await openEditor('<p><em>Prima</em></p>');
    const marks = bold ? [editor.schema.marks.bold.create()] : [];
    act(() => {
      editor.commands.setTextSelection(1);
      editor.view.dispatch(editor.state.tr.setStoredMarks(marks));
      editor.commands.setHardBreak(); editor.commands.setHardBreak();
      editor.commands.insertContent('X');
    });
    for (const position of [1, 2, 3]) expect(editor.state.doc.nodeAt(position)?.marks).toEqual(marks);
    expect(editor.state.doc.nodeAt(4)?.marks.map(mark => mark.type.name)).toEqual(['italic']);
  });

  it('publishes a live HTML getter when the editor-ready callback changes', async () => {
    let getHtml: (() => string) | undefined;
    const firstReady = vi.fn((getter: () => string) => { getHtml = getter; });
    const mounted = render(<RichTextEditor initialContent="<p>Prima</p>" onEditorReady={firstReady} />);
    await waitFor(() => expect(getHtml?.()).toContain('Prima'));
    const nextReady = vi.fn((getter: () => string) => { getHtml = getter; });
    mounted.rerender(<RichTextEditor initialContent="<p>Prima</p>" onEditorReady={nextReady} />);
    await waitFor(() => expect(nextReady).toHaveBeenCalled());
    const element = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
    act(() => { element.editor.commands.setContent('<p>Dopo riapertura</p>'); });
    expect(getHtml?.()).toContain('Dopo riapertura');
    mounted.unmount();
  });
  it('keeps direct block typography on text outside a partial clear selection', async () => {
    const { editor, element } = await openEditor('<h2 data-document-line-spacing="1.6" style="font-family:Georgia;font-size:18pt;font-weight:700;font-style:italic;color:#123abc;text-align:center;line-height:1.92;margin-top:8pt;margin-bottom:10pt">Prima scelta dopo</h2><p></p>');
    const original = editor.getJSON();
    act(() => { editor.commands.setTextSelection({ from: 7, to: 13 }); editor.commands.clearDocumentFormatting(); });
    const heading = editor.getJSON().content![0] as JSONContent;
    expect(heading.type).toBe('heading');
    expect(heading.attrs).toMatchObject({ textAlign: 'center', nativeLineSpacing: 1.6, documentStyle: { 'line-height': '1.92', 'margin-top': '8pt', 'margin-bottom': '10pt' } });
    expect(heading.content?.find(node => node.text === 'scelta')?.marks).toBeUndefined();
    for (const label of ['Prima ', ' dopo']) {
      expect(heading.content?.find(node => node.text === label)?.marks).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ fontFamily: 'Georgia', fontSize: '18pt', color: 'rgb(18, 58, 188)' }) }),
        expect.objectContaining({ type: 'bold' }), expect.objectContaining({ type: 'italic' }),
      ]));
    }
    const cleared = editor.getHTML();
    act(() => { editor.commands.selectAll(); });
    const model = JSON.parse(JSON.parse(transfer(element, 'copy').formats[NATIVE_SLICE_MIME]).data).resolved;
    expect(model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.find(Boolean)).toMatchObject({ ps_al: 1, ps_ls: 1.6, ps_sb: 8, ps_sa: 10 });
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.setContent(cleared); });
    expect(editor.getHTML()).toEqual(cleared);
  });

  it('clears future typing at an empty caret without changing existing typography or paragraph layout', async () => {
    const { editor } = await openEditor('<p data-document-line-spacing="1.6" style="font-family:Georgia;font-size:18pt;font-weight:700;font-style:italic;color:#123abc;text-align:center;line-height:1.92;margin-top:8pt;margin-bottom:10pt">Prima scelta dopo</p>');
    const original = editor.getJSON();
    act(() => { editor.commands.setTextSelection(7); editor.commands.clearDocumentFormatting(); });
    expect(editor.getJSON().content![0].attrs).toMatchObject({ textAlign: 'center', nativeLineSpacing: 1.6, documentStyle: { 'line-height': '1.92', 'margin-top': '8pt', 'margin-bottom': '10pt' } });
    act(() => { editor.commands.insertContent('NUOVO'); });
    const paragraph = editor.getJSON().content![0] as JSONContent;
    expect(paragraph.content?.find(node => node.text === 'NUOVO')?.marks).toBeUndefined();
    for (const label of ['Prima ', 'scelta dopo']) {
      expect(paragraph.content?.find(node => node.text === label)?.marks).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ fontFamily: 'Georgia', fontSize: '18pt' }) }),
        expect.objectContaining({ type: 'bold' }), expect.objectContaining({ type: 'italic' }),
      ]));
    }
    act(() => { editor.commands.undo(); editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
  });

  it('resets paragraph layout only for fully selected blocks in a selection spanning several paragraphs', async () => {
    const paragraph = (text: string) => `<p data-document-line-spacing="1.6" style="font-family:Georgia;line-height:1.92;margin-top:8pt;margin-bottom:10pt;text-align:center">${text}</p>`;
    const { editor } = await openEditor(['primo', 'centrale', 'ultimo'].map(paragraph).join(''));
    const original = editor.getJSON();
    act(() => { editor.commands.setTextSelection({ from: 3, to: editor.state.doc.content.size - 3 }); editor.commands.clearDocumentFormatting(); });
    const blocks = editor.getJSON().content!;
    for (const block of [blocks[0], blocks[2]]) expect(block.attrs).toMatchObject({ textAlign: 'center', nativeLineSpacing: 1.6, documentStyle: { 'line-height': '1.92', 'margin-top': '8pt', 'margin-bottom': '10pt' } });
    expect(blocks[1].attrs).toMatchObject({ textAlign: null, nativeLineSpacing: null, documentStyle: null });
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
  });

  it('keeps the native slice and its LaTeX source when one formula has no native equation', async () => {
    const { editor, element } = await openEditor('<h3>Formule</h3><p><span style="color:#123abc"><mark data-color="#ffee00">Scelto</mark></span> <span data-math="x^2">x</span></p><div data-math-block="\\begin{matrix}a&amp;b\\end{matrix}">matrice</div>');
    act(() => { editor.commands.selectAll(); });
    const { formats } = transfer(element, 'copy');
    expect(JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved.dsl_spacers).toContain('$$\\begin{matrix}a&b\\end{matrix}$$\n');
    const html = new DOMParser().parseFromString(formats['text/html'], 'text/html');
    expect(html.querySelectorAll('.katex')).toHaveLength(2);
    expect(html.querySelector('.katex-mathml,annotation')).toBeNull();
    expect(html.querySelector('.math-rendered-html')?.textContent).not.toContain('<span');
    expect(formats['text/plain']).toContain('x^2');
    expect(formats['text/html']).toContain('data-math-block="\\begin{matrix}a&amp;b\\end{matrix}"');
    const original = editor.getHTML();
    act(() => { editor.commands.setContent(editor.getHTML()); });
    expect(editor.getHTML()).toEqual(original);
  });

  it.each(['toolbar', 'context', 'keyboard'])('clears direct formatting through %s while preserving structure, links and undo', async path => {
    const { editor, element } = await openEditor('<h2 style="font-family:Georgia;font-size:18pt;color:#123abc;text-align:center;margin-top:30pt"><strong>Titolo</strong></h2><ol start="4"><li><p><mark data-color="#ffee00"><em>Voce</em></mark></p></li></ol><table><tr><td><p><a href="https://example.com"><strong>Link</strong></a><span data-math="x^2">x</span></p></td></tr></table><p>Fine</p>');
    await act(async () => { editor.commands.focus(); editor.commands.selectAll(); });
    const original = editor.getJSON();
    if (path === 'context') {
      render(<EditorContextMenu contextMenu={{ x: 20, y: 20 }} onClose={() => {}} editor={editor} onOpenMath={() => {}} onOpenImagePicker={() => {}} onOpenFind={() => {}} />);
      fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>('.editor-context-menu-item')).find(button => button.textContent?.includes('Rimuovi formattazione'))!);
    } else if (path === 'keyboard') fireEvent.keyDown(element, { key: '\\', code: 'Backslash', ctrlKey: true });
    else fireEvent.click(document.querySelector<HTMLButtonElement>('.editor-toolbar [title="Rimuovi formattazione"]')!);
    const html = editor.getHTML();
    expect(html).toContain('<h2>Titolo</h2>');
    expect(html).toContain('<ol start="4">');
    expect(html).toContain('<table');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('data-math="x^2"');
    expect(html).not.toMatch(/<strong>|<em>|<mark|Georgia|123abc|30pt|text-align/);
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
  });

  it('preserves explicit block styles and reports pixel font sizes in points', async () => {
    const { editor } = await openEditor('<h2 style="font-family:Georgia;font-size:24px;font-weight:700;color:#123abc;line-height:2;margin:30pt 0 12pt">Scelto</h2>');
    act(() => { editor.commands.setTextSelection(2); });
    expect(screen.getByTitle('Dimensione carattere').textContent).toContain('18');
    const html = editor.getHTML();
    expect(html).toContain('font-family: Georgia');
    expect(html).toContain('font-size: 24px');
    expect(html).toContain('margin-top: 30pt');
    act(() => { editor.commands.setContent(html); });
    expect(editor.getHTML()).toBe(html);
  });

  it('copies a partial heading with its inherited typography and explicit marks', async () => {
    const { editor, element } = await openEditor('<h2>Prima <span style="font-family:Georgia;color:#123abc"><em>scelta</em></span> dopo</h2><p></p>');
    const original = editor.getJSON();
    act(() => { editor.commands.setTextSelection({ from: 7, to: 13 }); });
    const { formats } = transfer(element, 'copy');
    const model = JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved;
    const textStyle = model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles.find(Boolean);
    expect(model.dsl_spacers.trim()).toBe('scelta');
    expect(textStyle).toMatchObject({ ts_fs: 16, ts_ff: 'Georgia', ts_it: true, ts_fgc2: { hclr_color: '#123abc' } });
    expect(editor.getJSON()).toEqual(original);
  });

  it('cuts using exactly the copy formats and deletes once with undo', async () => {
    const { editor, element } = await openEditor('<h2>Introduzione</h2><p>Testo <strong>importante</strong><br>fine</p>');
    const original = editor.getJSON();
    act(() => { editor.commands.selectAll(); });
    const copied = transfer(element, 'copy').formats;
    const cut = transfer(element, 'cut');
    expect(cut.formats).toEqual(copied);
    expect(cut.event.defaultPrevented).toBe(true);
    expect(editor.getText()).toBe('');
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
  });

  it('does not delete when a cut event cannot transfer clipboard data', async () => {
    const { editor, element } = await openEditor('<p>Conservare</p>');
    act(() => { editor.commands.selectAll(); });
    const original = editor.getJSON();
    act(() => { element.dispatchEvent(new Event('cut', { bubbles: true, cancelable: true })); });
    expect(editor.getJSON()).toEqual(original);
  });

  it('does not delete when a native clipboard format is rejected', async () => {
    const { editor, element } = await openEditor('<p>Conservare</p>');
    act(() => { editor.commands.selectAll(); });
    const original = editor.getJSON();
    const event = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: () => { throw new Error('Rejected format'); } } });
    act(() => { element.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getJSON()).toEqual(original);
  });

  it('does not paste after the selection changes during an asynchronous clipboard read', async () => {
    const { editor } = await openEditor('<p>Prima dopo</p>');
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let finish!: (text: string) => void;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })),
    } });
    try {
      act(() => { editor.commands.setTextSelection({ from: 1, to: 6 }); });
      const original = editor.getJSON();
      const paste = pasteEditorClipboard(editor.view, true);
      act(() => { editor.commands.setTextSelection({ from: 7, to: 11 }); });
      await act(async () => { finish('Sostituzione'); expect(await paste).toBe(false); });
      expect(editor.getJSON()).toEqual(original);
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('preserves supported explicit styles during formatted paste and serialization', async () => {
    const { editor } = await openEditor('<p></p>');
    act(() => {
      editor.view.pasteHTML('<h2><span style="font-size:18pt;font-family:Georgia;color:#123abc">Titolo scelto</span></h2><p><mark data-color="#ffee00" style="background-color:#ffee00"><span style="color:#123abc">Evidenziato</span></mark></p>', new Event('paste') as ClipboardEvent);
    });
    const html = editor.getHTML();
    expect(html).toContain('font-size: 18pt');
    expect(html).toContain('font-family: Georgia');
    expect(html).toContain('color: rgb(18, 58, 188)');
    expect(html).toContain('background-color: rgb(255, 238, 0)');
    act(() => { editor.commands.setContent(html); });
    expect(editor.getHTML()).toBe(html);
  });

  it('keeps mixed HTML text and an image when the clipboard also exposes an image file', async () => {
    const { editor } = await openEditor('<p></p>');
    const html = '<p>Prima<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9N0AAAAASUVORK5CYII=">Dopo</p>';
    const event = new Event('paste') as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: {
      files: [new File(['image'], 'clipboard.png', { type: 'image/png' })],
      getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'PrimaDopo' : '',
    } });
    act(() => { editor.view.pasteHTML(html, event); });
    expect(editor.getText()).toBe('PrimaDopo');
    expect(editor.getJSON().content?.[0].content?.map(node => node.type)).toEqual(['text', 'floatingImage', 'text']);
  });

  it('finds a word across formatting marks but does not join paragraphs or atomic nodes', async () => {
    const { editor } = await openEditor('<p>ana<strong>tom</strong>ia ANATOMIA</p><p>ana</p><p>tomia</p><p>ana<span data-math="x">x</span>tomia</p><p>ana<br>tomia</p>');
    act(() => { editor.commands.setSearchTerm('anatomia'); });
    expect(getSearchMatches(editor)).toEqual([{ from: 1, to: 9 }, { from: 10, to: 18 }]);
    act(() => { editor.commands.setSearchTerm('anatomia', 0, true); });
    expect(getSearchMatches(editor)).toEqual([{ from: 1, to: 9 }]);
    expect(document.querySelector('.search-highlight-active')?.textContent).toBe('ana');
  });
});
