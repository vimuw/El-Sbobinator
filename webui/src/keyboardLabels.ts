import { getHostCapabilities } from './hostCapabilities';

// Shortcut labels are written the Windows way ("Ctrl+Shift+V"). On an iPad or a Mac the same
// shortcuts run with ⌘ (the handlers accept metaKey / TipTap's Mod-), so the web build shows the
// Apple glyphs there. The desktop app keeps its labels.

/** iPhone, iPad (which reports itself as a Mac with touch) or Mac. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '';
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

const GLYPHS: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' };
// Apple's order of modifiers: ⌥ ⇧ ⌘ then the key.
const ORDER = ['Alt', 'Shift', 'Ctrl'];

export function appleShortcutLabel(label: string): string {
  return label.replace(/((?:Ctrl|Alt|Shift)\+)+([^\s/)]+)/g, (combo: string) => {
    const parts = combo.split('+');
    // "Ctrl++": the key itself is "+".
    const key = combo.endsWith('++') ? '+' : parts[parts.length - 1];
    const modifiers = parts.filter(part => part in GLYPHS);
    const glyphs = ORDER.filter(name => modifiers.includes(name)).map(name => GLYPHS[name]).join('');
    return /^[\p{L}]{2,}$/u.test(key) ? `${glyphs} ${key}` : `${glyphs}${key}`;
  });
}

/** The label for this device: Apple glyphs on the web build on Apple devices, unchanged elsewhere. */
export function shortcutLabel(label: string): string {
  return getHostCapabilities().kind === 'web' && isApplePlatform() ? appleShortcutLabel(label) : label;
}
