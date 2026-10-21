import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./editorTypography.css', import.meta.url), 'utf8');
const preludes = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .match(/[^{};]+(?=\{)/g)!
  .map(prelude => prelude.trim());

describe('editor typography stylesheet', () => {
  it('scopes every rule to the editor without document-wide restyle selectors', () => {
    const selectors = preludes.filter(prelude => !prelude.startsWith('@')).flatMap(prelude => prelude.split(/,(?![^(]*\))/).map(s => s.trim()));
    expect(selectors.length).toBeGreaterThan(50);
    for (const selector of selectors) {
      expect(selector).toMatch(/^\.tiptap-editor( |$)/);
      // A :not(... *) ancestor test made each focus change restyle every block.
      expect(selector).not.toContain(':not(');
      expect(selector).not.toContain('prose');
    }
  });

  it('keeps paragraphs and lists out of sibling rule subjects so inserting a block does not restyle the document', () => {
    const selectors = preludes.filter(prelude => !prelude.startsWith('@')).flatMap(prelude => prelude.split(/,(?![^(]*\))/).map(s => s.trim()));
    const siblingRules = selectors.filter(selector => /[+~]/.test(selector));
    expect(siblingRules.length).toBeGreaterThan(0);
    for (const selector of siblingRules) {
      // `h2 + *` restyled every block, `h2 + p` every paragraph, whenever Enter or a list added one.
      const subject = selector.slice(selector.search(/[+~]/) + 1);
      expect(subject).not.toMatch(/\*|\b(p|ul|ol|li|h[1-6])\b/);
    }
    // Narrowing to blockquote and pre relies on index.css setting the top margin of the rest.
    const index = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
    expect(index).toMatch(/\.tiptap-editor p \{[^}]*margin-top: 0;/);
    expect(index).toMatch(/\.tiptap-editor :is\(ul, ol\) \{[^}]*margin-top: 0;/);
    for (const level of [2, 3, 4]) {
      expect(index).toMatch(new RegExp(`\\.tiptap-editor h${level} \\{[^}]*margin: var\\(--document-h${level}-before\\)`));
    }
  });

  it('tests :*-of-type only on elements already inside their ancestor', () => {
    const selectors = preludes.filter(prelude => !prelude.startsWith('@')).flatMap(prelude => prelude.split(/,(?![^(]*\))/).map(s => s.trim()));
    const positional = selectors.filter(selector => /-of-type|:nth-/.test(selector));
    expect(positional.length).toBeGreaterThan(0);
    for (const selector of positional) {
      // `:where(blockquote p:first-of-type)` tested every paragraph of the document, so Enter and
      // lists restyled them all. A separate ancestor compound lets Chromium skip them.
      expect(selector).not.toMatch(/:where\([^()]*\s[^()]*(-of-type|:nth-)/);
      expect(selector).toMatch(/:where\([a-z]+\) :where\([a-z]+:[a-z-]+\)/);
    }
  });

  it('keeps the plugin rules below the editor overrides in index.css', () => {
    // Inside the utilities layer, so the unlayered editor rules in index.css still win.
    expect(preludes[0]).toBe('@layer utilities');
    expect(preludes.filter(prelude => prelude.startsWith('@layer'))).toHaveLength(1);
    const index = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
    expect(index).toContain('@import "./editorTypography.css";');
    expect(index).not.toContain('@tailwindcss/typography');
  });
});
