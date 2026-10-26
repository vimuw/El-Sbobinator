import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REVISION_WARNING_TEXT, buildBody, buildFinalMarkdown, markdownToHtmlBody, normalizeInlineStarLists } from './export';
import { buildMacroBlocks, detectDegenerateOutput, localMacroCleanup, safeOutputBasename, sequenceRatio } from './text';

// Expected values come from running the desktop functions (revision_service.build_macro_blocks,
// dedup_utils.local_macro_cleanup, gemini_errors.detect_degenerate_output, html_export) on the same input.
const para = (i: number) => `Paragrafo numero ${i}: ` + 'testo di prova sulla fisiologia renale e sul filtrato glomerulare. '.repeat(3);

describe('text helpers ported from the desktop', () => {
  it('splits macro blocks like build_macro_blocks', () => {
    const text = '## Titolo\n\n' + Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n')
      + '\n\n### Sotto\n\n' + Array.from({ length: 8 }, (_, i) => para(i + 12)).join('\n\n');
    expect(buildMacroBlocks(text, 1200).map(block => block.length)).toEqual([1126, 1115, 1131, 1120]);
  });

  it('removes only certain duplicates like local_macro_cleanup', () => {
    const dup = [para(1), para(2), para(1), '## Titolo ripetuto qui', '## Titolo ripetuto qui', para(3), para(3) + '!'].join('\n\n');
    const [text, removedExact, removedAdjacent] = localMacroCleanup(dup);
    expect([removedExact, removedAdjacent]).toEqual([2, 2]);
    expect(text).toBe(`${para(1).trim()}\n\n## Titolo ripetuto qui\n\n${para(3).trim()}`);
    expect(localMacroCleanup('  ')).toEqual(['', 0, 0]);
  });

  it('matches difflib.SequenceMatcher.ratio', () => {
    expect(sequenceRatio('abcd', 'bcde')).toBeCloseTo(0.75, 10);
    expect(sequenceRatio('', '')).toBe(1);
  });

  it('flags degenerate output like detect_degenerate_output', () => {
    expect(detectDegenerateOutput(Array(4).fill(para(1)).join('\n\n'))).toBe('paragrafo ripetuto 4 volte');
    expect(detectDegenerateOutput(para(1))).toBeNull();
    expect(detectDegenerateOutput('x'.repeat(12001))).toBe('paragrafo troppo lungo (12001 caratteri)');
    expect(detectDegenerateOutput('')).toBeNull();
  });

  it('cleans file names like safe_output_basename', () => {
    expect(safeOutputBasename('  Lezione: 1/2?  ')).toBe('Lezione_ 1_2_');
    expect(safeOutputBasename('')).toBe('Sbobina');
  });
});

describe('Markdown export', () => {
  it('normalizes unicode and inline star lists like normalize_inline_star_lists', () => {
    expect(normalizeInlineStarLists('Esempi: * Primo elemento * Secondo elemento\n● Voce A\n○ Sotto voce\nTesto\n- lista'))
      .toBe('Esempi:\n\n- Primo elemento\n- Secondo elemento\n- Voce A\n    - Sotto voce\nTesto\n\n- lista');
    expect(normalizeInlineStarLists('a\u00a0b')).toBe('a b');
    expect(detectDegenerateOutput(Array(4).fill(para(1).replace(/ /g, '\u00a0')).join('\n\n'))).toBe('paragrafo ripetuto 4 volte');
  });

  it('renders the same body as the desktop HTML export', () => {
    const md = buildFinalMarkdown('Lezione 1', ['## Il rene\n\nIl **rene** filtra il sangue.\n\nSecondo paragrafo.\n- **Glomerulo:** filtra.\n- **Tubulo:** riassorbe.\n\n### Tabella\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nFine <script>alert(1)</script> e x<sub>2</sub>.'], '');
    expect(md).toBe('# Lezione 1\n\n## Il rene\n\nIl **rene** filtra il sangue.\n\nSecondo paragrafo.\n\n- **Glomerulo:** filtra.\n- **Tubulo:** riassorbe.\n\n### Tabella\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nFine <script>alert(1)</script> e x<sub>2</sub>.');
    const desktop = '<h1>Lezione 1</h1>\n<h2>Il rene</h2>\n<p>Il <strong>rene</strong> filtra il sangue.</p>\n<p data-generated-space-before="15.18" style="margin-top:15.18pt">Secondo paragrafo.</p>\n<ul>\n<li><p data-generated-space-before="15.18" style="margin-top:15.18pt"><strong>Glomerulo:</strong> filtra.</p></li>\n<li><strong>Tubulo:</strong> riassorbe.</li>\n</ul>\n<h3>Tabella</h3>\n<table>\n<thead>\n<tr>\n<th>A</th>\n<th>B</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n<p>Fine  e x<sub>2</sub>.</p>';
    const tags = (html: string) => html.replace(/>\s+</g, '><').trim();
    expect(tags(markdownToHtmlBody(md))).toBe(tags(desktop));
  });

  it('keeps links to the web only and images only as data URLs', () => {
    const html = markdownToHtmlBody('[sito](https://example.org) [male](javascript:alert(1)) ![x](https://example.org/a.png) <b onclick="x()">testo</b>');
    expect(html).toContain('<a href="https://example.org">sito</a>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onclick');
    expect(html).toContain('testo');
  });

  it('adds the revision warning after the title like build_final_markdown', () => {
    const body = buildBody('# Titolo\n\nTesto.', true);
    expect(body.indexOf('revision-warning-banner')).toBeGreaterThan(body.indexOf('</h1>'));
    expect(body).toContain(REVISION_WARNING_TEXT);
    expect(buildBody('# Titolo\n\nTesto.', false)).not.toContain('revision-warning-banner');
    const python = readFileSync(new URL('../../../../el_sbobinator/services/export_service.py', import.meta.url), 'utf8');
    expect(python).toContain(`"${REVISION_WARNING_TEXT.slice(0, 30)}`);
  });

  it('falls back to the phase 1 text when no section was revised', () => {
    expect(buildFinalMarkdown('T', ['', '  '], 'Trascrizione grezza')).toBe('# T\n\nTrascrizione grezza');
  });
});
