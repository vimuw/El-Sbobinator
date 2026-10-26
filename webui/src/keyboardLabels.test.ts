import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from './hostCapabilities';
import { appleShortcutLabel, shortcutLabel } from './keyboardLabels';

describe('shortcut labels', () => {
  afterEach(() => {
    setHostCapabilities(DESKTOP_CAPABILITIES);
    vi.unstubAllGlobals();
  });

  it('writes Apple glyphs in Apple order', () => {
    expect(appleShortcutLabel('Ctrl+B')).toBe('⌘B');
    expect(appleShortcutLabel('Ctrl+Shift+V')).toBe('⇧⌘V');
    expect(appleShortcutLabel('Ctrl+Y / Ctrl+Shift+Z')).toBe('⌘Y / ⇧⌘Z');
    expect(appleShortcutLabel('Ctrl+Alt+1…5')).toBe('⌥⌘1…5');
    expect(appleShortcutLabel('Ctrl+Shift+L/E/R/J')).toBe('⇧⌘L/E/R/J');
    expect(appleShortcutLabel('Ctrl++ / Ctrl+−')).toBe('⌘+ / ⌘−');
    expect(appleShortcutLabel('Ctrl+\\')).toBe('⌘\\');
    expect(appleShortcutLabel('Shift+Invio')).toBe('⇧ Invio');
    expect(appleShortcutLabel('Tab / Shift+Tab')).toBe('Tab / ⇧ Tab');
    expect(appleShortcutLabel('Ctrl+clic')).toBe('⌘ clic');
    expect(appleShortcutLabel('Grassetto (Ctrl+B)')).toBe('Grassetto (⌘B)');
    expect(appleShortcutLabel('Precedente (Shift+Invio)')).toBe('Precedente (⇧ Invio)');
  });

  it('changes labels only on the web build on an Apple device', () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15' });
    expect(shortcutLabel('Ctrl+B')).toBe('Ctrl+B');
    setHostCapabilities({ kind: 'web' });
    expect(shortcutLabel('Ctrl+B')).toBe('⌘B');
    vi.stubGlobal('navigator', { ...navigator, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    expect(shortcutLabel('Ctrl+B')).toBe('Ctrl+B');
  });
});
