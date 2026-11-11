import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('./index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (selector: string, css = index) =>
  css.match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)} \\{([^}]*)\\}`))?.[1];
const phone = index.slice(index.indexOf('@media (max-width: 640px)'));

describe('phone layout', () => {
  it('draws both pinned ends of the phone toolbar alike: "A" and "+" get no tint of their own', () => {
    const start = rule('.editor-toolbar-pinned.is-start');
    const end = rule('.editor-toolbar-pinned.is-end');
    expect(start).not.toMatch(/background/);
    expect(end).not.toMatch(/background/);
    expect(end).toMatch(/border-left: 1px solid var\(--border-subtle\)/);
  });

  it('lets the text column shrink to the phone, so a table pasted from Google Docs cannot widen it', () => {
    // Docs tables arrive with fixed column widths (602 px in all): the flex column grew to fit
    // them and the whole document ran past both edges of the screen.
    const phoneEditor = index.slice(index.lastIndexOf('@media (max-width: 640px)', index.indexOf('padding: 20px 16px 32px')));
    expect(rule('.editor-page-center', phoneEditor)).toMatch(/min-width: 0/);
  });

  it('keeps card titles on one line, cut in the middle, so every card has the same height', () => {
    expect(phone).not.toMatch(/\.queue-card h4\.truncate|\.archive-session-card p\.truncate/);
    expect(rule('.middle-truncate', phone)).toMatch(/display: flex/);
    expect(rule('.middle-truncate-head', phone)).toMatch(/text-overflow: ellipsis/);
    expect(rule('.middle-truncate-tail', phone)).toMatch(/flex-shrink: 0/);
    // Only the phone splits the name: wider screens keep the ellipsis at the end.
    expect(index.slice(0, index.indexOf('@media (max-width: 640px)'))).not.toContain('.middle-truncate');
  });
});
