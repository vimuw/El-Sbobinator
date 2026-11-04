import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsRow } from './SettingsLayout';

// jsdom has no layout: these pin the CSS that keeps the settings readable on a phone, checked by
// eye at 320, 375, 768 and 1280 px in Chromium.

describe('settings on narrow screens', () => {
  it('lets a row wrap its control under a text that keeps a readable width', () => {
    render(
      <SettingsRow title="2. Apri il modulo" description="Descrivi il problema e incolla il report.">
        <button type="button">Segnala un problema</button>
      </SettingsRow>,
    );
    const row = screen.getByTestId('settings-row');
    // Before, the row never wrapped and a wide button squeezed the text into a narrow column.
    expect(row.className).toContain('flex-wrap');
    expect(screen.getByText('Descrivi il problema e incolla il report.').parentElement!.className).toContain('flex-[1_1_12rem]');
    expect(row.lastElementChild!.textContent).toBe('Segnala un problema');
  });

  it('sizes the phone tabs to their labels so "Archiviazione" stays inside its tab', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const nav = css.match(/\n\.settings-nav \{[^}]*\}/)?.[0] ?? '';
    expect(nav).toContain('grid-template-columns: repeat(var(--settings-tab-count, 3), minmax(max-content, 1fr));');
  });
});
