import katex from 'katex';

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Over-script characters that Word draws as an accent on its base.
const accents: Record<string, string> = { '^': '̂', 'ˆ': '̂', '→': '⃗', '⃗': '⃗', '~': '̃', '˜': '̃', '˙': '̇', '¨': '̈', 'ˇ': '̌' };
const bars = new Set(['¯', '‾', '̅']);
const scripts: Record<string, string> = { 'double-struck': 'double-struck', script: 'script', fraktur: 'fraktur' };

/**
 * Word's own equation format (OMML), built from KaTeX's semantic MathML, so
 * Word and the Google Docs import open an editable equation. Returns null for
 * structures without a faithful equivalent; the caller keeps the LaTeX text.
 */
export function latexToOmml(latex: string, displayMode: boolean): string | null {
  try {
    const html = katex.renderToString(latex, { output: 'mathml', displayMode, throwOnError: true, trust: false });
    const root = new DOMParser().parseFromString(html, 'text/html').querySelector('math > semantics > :first-child');
    if (!root) return null;
    const run = (text: string, style = '') => text ? `<m:r>${style ? `<m:rPr>${style}</m:rPr>` : ''}<m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>` : '';
    const all = (elements: Element[]) => elements.map(walk).join('');
    const walk = (el: Element): string => {
      const tag = el.localName.toLowerCase();
      const children = Array.from(el.children);
      const literal = el.textContent ?? '';
      const variant = el.getAttribute('mathvariant') ?? '';
      switch (tag) {
        case 'mi': {
          // Multi-letter identifiers (sin, log) are upright in MathML.
          const style = scripts[variant] ? `<m:scr m:val="${scripts[variant]}"/>`
            : variant === 'bold' ? '<m:sty m:val="b"/>'
            : variant === 'bold-italic' ? '<m:sty m:val="bi"/>'
            : variant === 'normal' || (!variant && [...literal].length > 1) ? '<m:sty m:val="p"/>' : '';
          return run(literal, style);
        }
        case 'mn': return run(literal);
        case 'mo': return run(literal.replace(/[⁡-⁣]/g, ''));
        case 'mtext': return run(literal, '<m:sty m:val="p"/>');
        case 'mspace': return Number.parseFloat(el.getAttribute('width') ?? '0') > 0.2 ? run(' ', '<m:sty m:val="p"/>') : '';
        case 'mphantom': return '';
        case 'mrow': case 'mstyle': case 'mpadded': {
          const open = children[0];
          const close = children[children.length - 1];
          if (tag === 'mrow' && children.length >= 2 && open.getAttribute('fence') === 'true' && close.getAttribute('fence') === 'true') {
            return `<m:d><m:dPr><m:begChr m:val="${escapeXml(open.textContent ?? '')}"/><m:endChr m:val="${escapeXml(close.textContent ?? '')}"/></m:dPr><m:e>${all(children.slice(1, -1))}</m:e></m:d>`;
          }
          return all(children);
        }
        case 'mfrac': {
          const noBar = ['0', '0px', '0em'].includes(el.getAttribute('linethickness') ?? '');
          return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${walk(children[0])}</m:num><m:den>${walk(children[1])}</m:den></m:f>`;
        }
        case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${all(children)}</m:e></m:rad>`;
        case 'mroot': return `<m:rad><m:deg>${walk(children[1])}</m:deg><m:e>${walk(children[0])}</m:e></m:rad>`;
        case 'msup': return `<m:sSup><m:e>${walk(children[0])}</m:e><m:sup>${walk(children[1])}</m:sup></m:sSup>`;
        case 'msub': return `<m:sSub><m:e>${walk(children[0])}</m:e><m:sub>${walk(children[1])}</m:sub></m:sSub>`;
        case 'msubsup': return `<m:sSubSup><m:e>${walk(children[0])}</m:e><m:sub>${walk(children[1])}</m:sub><m:sup>${walk(children[2])}</m:sup></m:sSubSup>`;
        case 'munder': return `<m:limLow><m:e>${walk(children[0])}</m:e><m:lim>${walk(children[1])}</m:lim></m:limLow>`;
        case 'mover': {
          const mark = children[1]?.textContent ?? '';
          if (bars.has(mark)) return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${walk(children[0])}</m:e></m:bar>`;
          if (accents[mark]) return `<m:acc><m:accPr><m:chr m:val="${accents[mark]}"/></m:accPr><m:e>${walk(children[0])}</m:e></m:acc>`;
          return `<m:limUpp><m:e>${walk(children[0])}</m:e><m:lim>${walk(children[1])}</m:lim></m:limUpp>`;
        }
        case 'munderover': return `<m:limUpp><m:e><m:limLow><m:e>${walk(children[0])}</m:e><m:lim>${walk(children[1])}</m:lim></m:limLow></m:e><m:lim>${walk(children[2])}</m:lim></m:limUpp>`;
        case 'mtable': {
          const rows = children.filter(row => row.localName === 'mtr');
          const columns = Math.max(1, ...rows.map(row => row.children.length));
          return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${columns}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${
            rows.map(row => `<m:mr>${Array.from({ length: columns }, (_, i) => `<m:e>${row.children[i] ? all(Array.from(row.children[i].children)) : ''}</m:e>`).join('')}</m:mr>`).join('')
          }</m:m>`;
        }
        default: throw new Error(`Unsupported MathML: ${tag}`);
      }
    };
    return `<m:oMath>${walk(root)}</m:oMath>`;
  } catch { return null; }
}
