import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('./index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (selector: string, css = index) =>
  css.match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)} \\{([^}]*)\\}`))?.[1];

describe('editor audio dock width', () => {
  it('fills narrow windows but stops at a fixed width on large monitors', () => {
    const dock = rule('.editor-player-dock');
    expect(dock).toMatch(/width: 100%/);
    expect(dock).toMatch(/max-width: 960px/);
  });

  it('folds the capped player in place once it no longer reaches the corner of its pill', () => {
    const wide = index.slice(index.indexOf('@media (min-width: 993px)'));
    expect(wide).not.toBe(index);
    // 993px = the 960px cap + the footer's 16px gutters on both sides, plus one.
    expect(rule('.editor-player-dock:has(> .audio-player.is-folding.is-left)', wide))
      .toMatch(/animation: audio-dock-empty-out/);
    expect(rule('.editor-player-dock:has(> .audio-player.did-fold.is-left:not(.is-collapsed):not(.is-folding))', wide))
      .toMatch(/animation: audio-dock-empty-in/);
  });

  it('steps the dock aside, open or folded, while the scroll pill shows, unless one of its menus is open', () => {
    const aside = rule(".editor-fullpage:has(.editor-scroll-percent[data-visible='true']) .editor-player-dock:not(:has([aria-expanded='true']))");
    expect(aside).toMatch(/opacity: 0/);
    expect(aside).toMatch(/pointer-events: none/);
    expect(rule('.editor-player-dock')).toMatch(/transition:[^;]*opacity/);
    // With a menu open the player is in use: the scroll pill waits instead.
    expect(rule(".editor-fullpage:has(.editor-player-dock [aria-expanded='true']) .editor-scroll-percent")).toMatch(/visibility: hidden/);
  });
});
