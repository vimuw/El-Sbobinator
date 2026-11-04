import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { sanitizeBodyHtml } from './export';

describe('sanitizeBodyHtml', () => {
  it('drops active content and keeps the editor markup', () => {
    const body = [
      '<h1 style="text-align: center">Titolo</h1>',
      '<p onclick="steal()">Testo <strong>forte</strong> <a href="javascript:alert(1)">link</a> <a href="https://example.com">ok</a></p>',
      '<script>alert(1)</script><style>p{}</style>',
      '<iframe src="https://evil.example"></iframe><object data="x"></object><form action="https://evil.example"><input></form>',
      '<img src="x" onerror="alert(1)"><img src="data:image/png;base64,AAAA" alt="figura"><img src="data:text/html,<script>alert(1)</script>">',
      '<span data-math="x^2">x²</span><table><tbody><tr><td>cella</td></tr></tbody></table>',
      '<a href="mailto:prof@uni.it">mail</a><a href="//evil.example">rel</a><div srcdoc="<script>"></div>',
    ].join('');
    const clean = sanitizeBodyHtml(body);
    expect(clean).not.toMatch(/script|onclick|onerror|javascript:|<iframe|<object|<form|<input|<style|srcdoc|data:text/i);
    expect(clean).not.toContain('evil.example');
    expect(clean).toContain('<h1 style="text-align: center">Titolo</h1>');
    expect(clean).toContain('<strong>forte</strong>');
    expect(clean).toContain('<a href="https://example.com">ok</a>');
    expect(clean).toContain('<a>link</a>');
    expect(clean).toContain('<img src="data:image/png;base64,AAAA" alt="figura">');
    expect(clean).toContain('<img src="x">');
    expect(clean).toContain('<span data-math="x^2">x²</span>');
    expect(clean).toContain('<td>cella</td>');
    expect(clean).toContain('<a href="mailto:prof@uni.it">mail</a>');
  });

  it('removes links the browser would follow as javascript: or to another host', () => {
    const body = [
      '<a href="java&#9;script:alert(1)">tab</a>',
      '<a href="java&#10;script:alert(1)">riga</a>',
      '<a href="&#1;javascript:alert(1)">controllo</a>',
      '<a href="\\\\evil.example/x">barre</a>',
      '<a href="/\\evil.example/x">miste</a>',
      '<img src="&#1;javascript:alert(1)">',
    ].join('');
    expect(sanitizeBodyHtml(body)).toBe('<a>tab</a><a>riga</a><a>controllo</a><a>barre</a><a>miste</a><img>');
  });

  it('drops SVG, whose animation elements can set a javascript: href', () => {
    const body = [
      '<p>prima</p>',
      '<svg><animate attributeName="href" values="javascript:alert(1)"/><a><text>x</text></a></svg>',
      '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
      '<p>dopo <span data-math="x^2">x²</span></p>',
    ].join('');
    expect(sanitizeBodyHtml(body)).toBe('<p>prima</p><p>dopo <span data-math="x^2">x²</span></p>');
  });

  it('keeps the MathML of formulas without its active parts', () => {
    // Regression: dropping all MathML left formulas from Drive or a backup as loose characters in
    // "Esporta nel mio Drive", which shows the stored text without KaTeX's stylesheet.
    const formula = katex.renderToString('\\sqrt{x}', { throwOnError: false, output: 'mathml' });
    expect(sanitizeBodyHtml(formula)).toBe(formula);
    const body = [
      '<math><maction actiontype="statusline"><mtext>y</mtext></maction>',
      '<mi href="javascript:alert(1)">x</mi>',
      '<semantics><mi>z</mi><annotation-xml encoding="text/html"><a href="https://evil.example">k</a></annotation-xml></semantics></math>',
    ].join('');
    expect(sanitizeBodyHtml(body)).toBe('<math><mi>x</mi><semantics><mi>z</mi></semantics></math>');
  });

  it('leaves nothing active when its result is parsed again (mutation XSS through MathML)', () => {
    // Regression: kept MathML let these through: parsed a second time (the Drive export's .html file),
    // the text inside the raw-text element became a live <img onerror>.
    const active = (html: string) => [...new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.querySelectorAll('*')]
      .some(element => [...element.attributes].some(attribute => attribute.name.startsWith('on')) || element.tagName.toLowerCase() === 'script');
    for (const raw of ['xmp', 'noembed', 'noframes']) {
      const body = `<math><mtext><table><mglyph><${raw}></math><img src=x onerror=alert(1)>`;
      const clean = sanitizeBodyHtml(body);
      expect(active(clean), raw).toBe(false);
      expect(sanitizeBodyHtml(clean), raw).toBe(clean);
    }
  });

  it('keeps the SVG images the editor stores as data: URLs', () => {
    const body = '<p><img src="data:image/svg+xml;base64,PHN2Zy8+" alt="schema"><img src="data:image/svg+xml,%3Csvg%2F%3E"></p>';
    expect(sanitizeBodyHtml(body)).toBe(body);
  });

  it('leaves a clean body unchanged', () => {
    const body = '<h1>Lezione</h1><p>Primo <em>paragrafo</em>.</p><ul><li>punto</li></ul>';
    expect(sanitizeBodyHtml(body)).toBe(body);
  });
});
