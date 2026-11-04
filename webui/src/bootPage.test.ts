import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const themeCss = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

function bgBase(block: string): string | undefined {
  return /--bg-base:\s*(#[0-9a-f]+)/i.exec(block)?.[1].toLowerCase();
}

describe('boot page before React mounts', () => {
  it('shows no mock layout that the real screen would replace', () => {
    expect(html).toMatch(/<div id="root"><\/div>/);
    expect(html).not.toMatch(/skeleton/i);
  });

  it('paints the same background as the app in both themes', () => {
    const lightBoot = /:root\s*\{[^}]*--boot-bg:\s*(#[0-9a-f]+)/i.exec(html)?.[1].toLowerCase();
    const darkBoot = /:root\[data-theme="dark"\]\s*\{[^}]*--boot-bg:\s*(#[0-9a-f]+)/i.exec(html)?.[1].toLowerCase();
    const darkTheme = themeCss.slice(themeCss.indexOf(':root[data-theme="dark"]'));

    expect(lightBoot).toBe(bgBase(themeCss));
    expect(darkBoot).toBe(bgBase(darkTheme));
  });
});
