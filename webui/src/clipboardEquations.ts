import katex from 'katex';

export type ClipboardEquation = { text: string; functions: Array<{ at: number; command: string }> };

// Native Docs named operators are leaves (0x1f), distinct from functions with
// argument trees (0x19 ... 0x1b). These names were checked in Docs itself.
const namedOperators = new Set(['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'csc', 'sec', 'cot', 'ln', 'log', 'exp']);
const limitOperators: Record<string, string> = { '∑': 'sumab', '∏': 'prodab', '∐': 'coprodab', '⋂': 'bigcapab', '⋃': 'bigcupab', '∫': 'intab', '∮': 'ointab', lim: 'limab' };
const operatorText = (el: Element): string | null => {
  if (el.hasAttributes()) return null;
  if (['mi', 'mo'].includes(el.localName)) return el.textContent;
  if (el.localName !== 'mrow') return null;
  const operands = Array.from(el.children).filter(child => child.localName !== 'mo' || child.textContent !== '\u2061');
  return operands.length === 1 ? operatorText(operands[0]) : null;
};

// Docs equations are editable trees delimited by control characters. Convert
// semantic MathML, never the rendered KaTeX HTML or a screenshot of the formula.
// Unsupported structures must keep the existing HTML path intact.
export function createClipboardEquation(latex: string, displayMode: boolean): ClipboardEquation | null {
  try {
    const html = katex.renderToString(latex, { output: 'mathml', displayMode, throwOnError: true, trust: false });
    const root = new DOMParser().parseFromString(html, 'text/html').querySelector('math > semantics > :first-child');
    if (!root) return null;
    let text = '\u001a';
    const functions: ClipboardEquation['functions'] = [];
    const fn = (command: string, args: Array<Element | Element[] | null>) => {
      functions.push({ at: text.length, command: `\\${command}` });
      text += '\u0019';
      args.forEach((arg, i) => { if (i) text += '\u001d'; if (Array.isArray(arg)) arg.forEach(walk); else if (arg) walk(arg); });
      text += '\u001b';
    };
    const walk = (el: Element) => {
      const tag = el.localName.toLowerCase();
      const children = Array.from(el.children);
      const literal = el.textContent ?? '';
      const namedOperator = tag === 'mi' && el.nextElementSibling?.localName === 'mo' && el.nextElementSibling.textContent === '\u2061';
      if (namedOperator && namedOperators.has(literal) && !el.hasAttributes()) {
        functions.push({ at: text.length, command: `\\${literal}` });
        text += '\u001f';
        return;
      }
      if (namedOperator) throw new Error('Unsupported named equation operator');
      if ((el.hasAttribute('mathvariant') && el.getAttribute('mathvariant') !== 'italic') ||
          ['mathcolor', 'mathbackground', 'mathsize', 'displaystyle', 'scriptlevel'].some(attr => el.hasAttribute(attr))) {
        throw new Error('Unsupported equation styling');
      }
      if (tag === 'mtext' && literal.trim()) throw new Error('Roman text inside an equation');
      if (['mi', 'mn', 'mo', 'mtext'].includes(tag)) {
        if (el.getAttribute('stretchy') === 'true') throw new Error('Stretchy delimiter');
        text += literal.replace(/[\u2061\u2062]/g, '');
      } else if (['mrow', 'mstyle'].includes(tag)) {
        const open = children[0];
        const close = children[children.length - 1];
        const delimiter = ({ '()': 'rbracelr', '[]': 'sbracelr', '{}': 'bracelr', '∣∣': 'abs', '||': 'abs' } as Record<string, string>)[`${open?.textContent}${close?.textContent}`];
        if (tag === 'mrow' && open?.getAttribute('fence') === 'true' && close?.getAttribute('fence') === 'true' && delimiter) fn(delimiter, [children.slice(1, -1)]);
        else children.forEach(walk);
      } else if (tag === 'mfrac' && !el.hasAttribute('linethickness')) fn('frac', children);
      else if (tag === 'msqrt') fn('sqrt', [children]);
      else if (tag === 'mroot') fn('rootof', [children[1], children[0]]);
      else if (['msup', 'msub', 'msubsup', 'munderover', 'munder', 'mover'].includes(tag)) {
        const operator = operatorText(children[0]);
        const limits = operator ? limitOperators[operator] : undefined;
        if (limits) {
          const lower = ['msup', 'mover'].includes(tag) ? null : children[1];
          const upper = ['msub', 'munder'].includes(tag) ? null : children[['msubsup', 'munderover'].includes(tag) ? 2 : 1];
          // Docs uses a one-argument function for the ordinary lower limit.
          if (operator === 'lim' && !upper) fn('lima', [lower]);
          else fn(limits, [lower, upper]);
        } else if (['msup', 'msub', 'msubsup'].includes(tag)) fn(({ msup: 'superscript', msub: 'subscript', msubsup: 'subsuperscript' })[tag]!, children);
        else if (tag === 'mover' && ['¯', '‾', '^', 'ˆ'].includes(children[1]?.textContent ?? '')) fn(['^', 'ˆ'].includes(children[1].textContent ?? '') ? 'widehat' : 'overline', [children[0]]);
        else throw new Error('Unsupported equation function');
      } else if (tag === 'mspace') {
        const width = Number.parseFloat(el.getAttribute('width') ?? '0');
        if (width !== 0) throw new Error('Explicit equation spacing');
      } else throw new Error(`Unsupported MathML: ${tag}`);
    };
    walk(root);
    return { text: `${text}\u001e`, functions };
  } catch { return null; }
}
