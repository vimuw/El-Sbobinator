import { describe, expect, it } from 'vitest';
import { createClipboardEquation } from './clipboardEquations';

describe('Editable clipboard equations', () => {
  it.each(['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'csc', 'sec', 'cot', 'ln', 'log', 'exp'])('preserves %s as a native named function rather than italic letters', name => {
    const equation = createClipboardEquation(`\\${name} x`, false)!;
    expect(equation).toEqual({ text: '\u001a\u001fx\u001e', functions: [{ at: 1, command: `\\${name}` }] });
  });
  it.each([false, true])('preserves native operator limits with displayMode=%s', displayMode => {
    expect(createClipboardEquation('\\lim_{x\\to0}x', displayMode)).toEqual({
      text: '\u001a\u0019x→0\u001bx\u001e', functions: [{ at: 1, command: '\\lima' }],
    });
    for (const [operator, command] of [['sum', 'sumab'], ['prod', 'prodab'], ['int', 'intab'], ['oint', 'ointab']]) {
      const equation = createClipboardEquation(`\\${operator}_{i=0}^{n}x`, displayMode)!;
      expect(equation).toEqual({ text: '\u001a\u0019i=0\u001dn\u001bx\u001e', functions: [{ at: 1, command: `\\${command}` }] });
    }
  });
  it('retains named functions inside powers and fractions without changing ordinary variables', () => {
    const equation = createClipboardEquation('\\frac{\\sin^2 x}{\\log_{2}y}+s i n', false)!;
    expect(equation.functions.map(fn => fn.command)).toEqual(['\\frac', '\\superscript', '\\sin', '\\subscript', '\\log']);
    expect(equation.text.endsWith('+sin\u001e')).toBe(true);
    equation.functions.forEach(fn => expect(['\u0019', '\u001f']).toContain(equation.text[fn.at]));
  });
  it.each(['\\operatorname{rank}A', '\\operatorname{sin}x', '\\mathrm{sin}x', '\\max x', '\\mathbf{\\sin x}', '\\color{red}{\\sum_{i=0}^{n}x}'])('keeps unverified names or styling in the HTML path: %s', latex => {
    expect(createClipboardEquation(latex, false)).toBeNull();
  });
  it.each([
    ['x_i^2', '\\subsuperscript'],
    ['\\frac{a}{b}', '\\frac'],
    ['\\sqrt{x+y}', '\\sqrt'],
    ['\\sqrt[3]{x}', '\\rootof'],
    ['\\sum_{i=0}^{n}i', '\\sumab'],
    ['\\overline{x}', '\\overline'],
    ['\\hat{x}', '\\widehat'],
    ['\\left(\\frac{a}{b}\\right)', '\\rbracelr'],
  ])('converts %s into native editable functions', (latex, command) => {
    const equation = createClipboardEquation(latex, true)!;
    expect(equation.text.startsWith('\u001a')).toBe(true);
    expect(equation.text.endsWith('\u001e')).toBe(true);
    expect(equation.functions.map(fn => fn.command)).toContain(command);
    equation.functions.forEach(fn => expect(equation.text[fn.at]).toBe('\u0019'));
  });
  it('preserves nested fractions, symbols and operands', () => {
    const equation = createClipboardEquation('\\frac{\\alpha+\\sqrt{x}}{y^2}', false)!;
    expect(equation.functions.map(fn => fn.command)).toEqual(['\\frac', '\\sqrt', '\\superscript']);
    expect(equation.text).toContain('α+');
    expect(equation.text).toContain('x');
    expect(equation.text).toContain('y');
  });
  it.each(['\\begin{pmatrix}a&b\\end{pmatrix}', '\\unknown{x}', '\\cancel{x}', '\\mathbf{x}', '\\text{hello}', '\\color{red}{x}', 'x\\!y'])('keeps unsupported %s out of the native path', latex => {
    expect(createClipboardEquation(latex, true)).toBeNull();
  });
});
