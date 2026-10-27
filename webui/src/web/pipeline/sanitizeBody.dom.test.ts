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

  it('leaves a clean body unchanged', () => {
    const body = '<h1>Lezione</h1><p>Primo <em>paragrafo</em>.</p><ul><li>punto</li></ul>';
    expect(sanitizeBodyHtml(body)).toBe(body);
  });
});
