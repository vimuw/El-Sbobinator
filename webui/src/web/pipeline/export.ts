// Markdown -> HTML body, port of el_sbobinator/utils/html_export.py and services/export_service.py.
// The body is what the archive stores and the editor opens, like the body of a desktop *_Sbobina.html.
//
// Differences from the desktop, on purpose:
//  - marked (CommonMark + GFM tables) instead of python-markdown "extra": nested lists indented by
//    2 spaces nest here, python-markdown wants 4.
//  - Sanitizing: instead of nh3 over the rendered HTML, raw HTML from the model is handled at the
//    source as nh3 would: script/style go with their content, a few bare inline tags stay, any
//    other tag is dropped and its text kept; link/image URLs are checked. Only marked's own markup
//    reaches the output.

import { Marked, type Token, type Tokens } from 'marked';
import FMT from '../../../../el_sbobinator/document_formatting.json';

export const REVISION_WARNING_TEXT = 'Attenzione: alcune sezioni sono state incluse senza revisione AI.';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LIST_LINE = /^\s*([*+-]|\d+\.)\s+/;

/** Python's str.splitlines(): no trailing empty item after a final newline. */
function splitLines(s: string): string[] {
  const lines = s.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Port of normalize_inline_star_lists. */
export function normalizeInlineStarLists(md: string): string {
  const src = (md ?? '').replace(/\u00a0/g, ' ');
  const bulletTop = new Set(['●', '•', '▪', '‣', '■']);
  const out: string[] = [];
  let inFence = false;
  for (let line of splitLines(src)) {
    const s = line.trim();
    if (s.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // A: line starting with a unicode bullet -> Markdown list item.
    if (!LIST_LINE.test(line)) {
      const m = /^(\s*)([●•▪‣◦○∙■□])\s+(.*)$/.exec(line);
      if (m && m[3].trim()) {
        out.push((bulletTop.has(m[2]) ? '- ' : '    - ') + m[3].trim());
        continue;
      }
    }
    // B: unicode bullets in the middle of a line -> split into a list.
    if (!LIST_LINE.test(line) && /[●•▪‣■□]\s+(\*\*|[A-ZÀ-ÖØ-Ý])/.test(line) && /\s[●•▪‣■□]\s+/.test(line)) {
      const parts = line.split(/\s*[●•▪‣■□]\s+/);
      if (parts.length > 1) {
        const first = (parts[0] ?? '').trimEnd();
        if (first) out.push(first);
        for (const item of parts.slice(1)) if (item.trim()) out.push('- ' + item.trim());
        continue;
      }
    }
    // "Esempi: * Voce1 ... * Voce2 ..."
    if (!LIST_LINE.test(line) && /:[ \t]*\*[ \t]+(\*\*|[A-ZÀ-ÖØ-Ý])/.test(line) && line.includes('* ')) {
      line = line.replace(/:[ \t]*\*[ \t]+/, ':\n\n- ').replace(/[ \t]+\*[ \t]+/g, '\n- ');
      out.push(...line.split('\n'));
      continue;
    }
    out.push(line);
  }
  // Blank line before a list that follows a paragraph line.
  const fixed: string[] = [];
  inFence = false;
  const isList = (l: string) => /^\s{0,3}([*+-]|\d+\.)\s+/.test(l);
  for (const line of out) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      fixed.push(line);
      continue;
    }
    if (!inFence && isList(line) && fixed.length) {
      const prev = fixed[fixed.length - 1];
      if (prev.trim() !== '' && !isList(prev)) fixed.push('');
    }
    fixed.push(line);
  }
  return fixed.join('\n');
}

/** Port of normalize_heading_levels: clamp headings to h1-h5. */
export function normalizeHeadingLevels(md: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of splitLines(md ?? '')) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      lines.push(line);
      continue;
    }
    const m = inFence ? null : /^(\s*)(#{1,})\s+(.*)$/.exec(line);
    lines.push(m ? `${m[1]}${'#'.repeat(Math.min(m[2].length, 5))} ${m[3].trim()}` : line);
  }
  return lines.join('\n');
}

const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const INLINE_HTML_OK =/^<\/?(sub|sup|u|s|mark|br)\s*\/?>$/i;
const safeUrl = (href: string, schemes: string[]) => {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim());
  return m ? schemes.includes(m[1].toLowerCase()) : !href.trim().startsWith('//');
};

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      if ('block' in token && token.block) {
        const text = token.text.replace(/<[^>]*>/g, '').trim();
        return text ? `<p>${escapeHtml(text)}</p>\n` : '';
      }
      return INLINE_HTML_OK.test(token.text.trim()) ? token.text.trim().toLowerCase() : '';
    },
    link(token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      if (!safeUrl(token.href, ['http', 'https', 'mailto'])) return inner;
      return `<a href="${escapeHtml(token.href)}"${token.title ? ` title="${escapeHtml(token.title)}"` : ''}>${inner}</a>`;
    },
    image(token: Tokens.Image) {
      if (!/^data:image\//i.test(token.href)) return escapeHtml(token.text);
      return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}">`;
    },
  },
});

const GAP_PT = Math.round(FMT.fontSizePt * FMT.lineHeight * 100) / 100;
const SPACE_ATTRS = `data-generated-space-before="${GAP_PT}" style="margin-top:${GAP_PT}pt"`;

/** Port of space_generated_blocks for top-level p/ul/ol following p/ul/ol. */
function addSpaceBefore(html: string, type: 'paragraph' | 'list'): string {
  if (type === 'paragraph') return html.replace(/^<p>/, `<p ${SPACE_ATTRS}>`);
  const li = html.indexOf('<li>');
  if (li < 0) return html;
  const after = li + 4;
  if (html.startsWith('<p>', after)) return html.slice(0, after) + `<p ${SPACE_ATTRS}>` + html.slice(after + 3);
  // Tight list: wrap the first item's inline content, leaving its child list intact.
  const rest = html.slice(after);
  const stop = rest.search(/<(ul|ol|pre|table|blockquote)[\s>]|<\/li>/);
  const end = stop < 0 ? rest.length : stop;
  return html.slice(0, after) + `<p ${SPACE_ATTRS}>${rest.slice(0, end).replace(/\s+$/, '')}</p>` + rest.slice(end);
}

export function markdownToHtmlBody(md: string): string {
  const tokens = marked.lexer(normalizeHeadingLevels(md).replace(SCRIPT_OR_STYLE, ''));
  const parts: string[] = [];
  let prev: string | null = null;
  for (const tok of tokens as Token[]) {
    if (tok.type === 'space') continue;
    const one = Object.assign([tok], { links: tokens.links }) as unknown as Parameters<typeof marked.parser>[0];
    let html = marked.parser(one) as string;
    const kind = tok.type === 'paragraph' || (tok.type === 'html' && (tok as Tokens.HTML).block) ? 'paragraph' : tok.type === 'list' ? 'list' : null;
    if (kind && (prev === 'paragraph' || prev === 'list')) html = addSpaceBefore(html, kind);
    parts.push(html);
    prev = kind ?? tok.type;
  }
  return parts.join('');
}

/** Port of export_service.build_final_markdown; buildBody adds the warning banner as HTML. */
export function buildFinalMarkdown(title: string, blocks: string[], fallbackBody = ''): string {
  let normalized = blocks.map((b) => (b ?? '').trim()).filter(Boolean);
  if (!normalized.length) normalized = [(fallbackBody ?? '').trim()];
  return normalizeInlineStarLists(`# ${title}\n\n${normalized.join('\n\n').trim()}\n`);
}

function warningBanner(): string {
  return `<div class="revision-warning-banner" style="border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; padding: 12px 14px; border-radius: 10px; margin: 0 0 18px;"><strong>${REVISION_WARNING_TEXT}</strong></div>\n`;
}

/** Body HTML: title h1, optional warning, content. */
export function buildBody(finalMarkdown: string, revisionFailed: boolean): string {
  const body = markdownToHtmlBody(finalMarkdown);
  if (!revisionFailed) return body;
  // Desktop puts the banner right after "# Title".
  const i = body.indexOf('</h1>');
  return i < 0 ? warningBanner() + body : body.slice(0, i + 5) + '\n' + warningBanner() + body.slice(i + 5);
}
