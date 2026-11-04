import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('./index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string, css = index) =>
  css.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.()>:]/g, '\\$&')} \\{([^}]*)\\}`))?.[1];

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
});
