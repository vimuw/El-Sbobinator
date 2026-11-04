import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_FORMATTING } from './documentFormatting';
import { DURATION, EASE_IN, EASE_OUT } from './motion';

const theme = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const stylesheet = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const index = stylesheet('./index.css');
// Every interface stylesheet. editorTypography.css is the document page's own typography.
const styles = [index, stylesheet('./components/FloatingImage.css'), stylesheet('./components/BrandLogo.css')].join('\n');
const componentSources = readdirSync(new URL('./components', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.tsx') && !file.includes('.test.'))
  .map(file => ({ file, source: readFileSync(new URL(`./components/${file.replace(/\\/g, '/')}`, import.meta.url), 'utf8') }));

const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
const lightTheme = theme.slice(0, theme.indexOf(':root[data-theme="dark"]'));
const darkTheme = theme.slice(theme.indexOf(':root[data-theme="dark"]'));
// The first top-level rule for a selector; `indent` reaches one nested in a media query.
const rule = (selector: string, indent = '') =>
  index.match(new RegExp(`(?:^|\\n)${indent}${selector.replace(/[.[\]'=]/g, '\\$&')} \\{([^}]*)\\}`))?.[1];

// WCAG relative luminance contrast between two #rrggbb colours.
const contrast = (a: string, b: string) => {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// How far an rgba() token, laid over a #rrggbb surface, moves its perceived lightness (CIELAB
// L*). Unlike the WCAG ratio, which inflates small steps between dark greys, this is the same
// scale in both themes, so a light and a dark token that separate equally score equally.
const lightnessStep = (rgba: string, surface: string) => {
  const [r, g, b, alpha] = rgba.match(/[\d.]+/g)!.map(Number);
  const base = [1, 3, 5].map(i => parseInt(surface.slice(i, i + 2), 16));
  const lstar = (rgb: number[]) => {
    const [lr, lg, lb] = rgb.map(c => c / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
  };
  return Math.abs(lstar([r, g, b].map((c, i) => c * alpha + base[i] * (1 - alpha))) - lstar(base));
};

// A theme token's value, following var() references; the dark theme falls back to the light one.
const themeValue = (name: string, dark: boolean): string => {
  const raw = (dark ? token(darkTheme, name) : undefined) ?? token(lightTheme, name);
  const reference = raw?.match(/^var\((--[\w-]+)\)$/)?.[1];
  return reference ? themeValue(reference, dark) : raw!;
};

// A #rrggbb or rgba() colour laid over a #rrggbb surface, as #rrggbb; `alpha` scales its opacity.
const mix = (colour: string, surface: string, alpha = 1) => {
  const [r, g, b, own = 1] = colour.startsWith('#')
    ? [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16))
    : colour.match(/[\d.]+/g)!.map(Number);
  const a = own * alpha;
  return `#${[r, g, b].map((c, i) => Math.round(c * a + parseInt(surface.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - a))
    .toString(16).padStart(2, '0')).join('')}`;
};

// CIELAB lightness of a #rrggbb colour.
const lstar = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
};

describe('app surfaces', () => {
  it('gives header, toolbar, page and menus a tone each in the light theme, as in the dark one', () => {
    // A white menu or player blended into the white page, and one in the header's beige into
    // the bars; the dark theme lifts its menus to a lighter grey of their own.
    const light = [token(lightTheme, '--editor-chrome-bg'), token(lightTheme, '--editor-toolbar-bg'), token(lightTheme, '--bg-floating'), '#ffffff'];
    expect(new Set(light).size).toBe(4);
    expect(index).toMatch(/:root:not\(\[data-theme="dark"\]\) \.editor-toolbar \{\s*background: var\(--editor-toolbar-bg\);/);
    expect(token(darkTheme, '--bg-floating')).toBe('var(--bg-elevated)');
    for (const selector of [
      '.kebab-panel', '.color-picker-panel', '.context-menu', '.editor-bubble-menu', '.link-panel',
      '.editor-link-card', '.sidebar-account-menu', '.select-dropdown', '.notification-dropdown-panel',
      '.phone-format-sheet', '.editor-player-dock',
    ]) {
      expect(rule(selector), selector).toMatch(/background: var\(--bg-floating\)/);
    }
  });

  it('separates borders, hover and selection in the light theme as much as in the dark one', () => {
    // Light borders at 0.16/0.24/0.46 and a 0.05 hover moved the white surface by about three
    // quarters (hover: half) of what the dark values move #202020: cards, fields, settings
    // panels and menu rows read flatter in the light theme than the same ones in the dark.
    for (const name of [
      '--border-subtle', '--border-default', '--border-strong', '--bg-hover', '--accent-subtle',
      '--processing-bg', '--progress-bg', '--card-queued-border', '--scrubber-rest',
    ]) {
      const light = lightnessStep(token(lightTheme, name)!, token(lightTheme, '--bg-surface')!);
      const dark = lightnessStep(token(darkTheme, name)!, token(darkTheme, '--bg-surface')!);
      expect(light / dark, name).toBeGreaterThan(0.9);
      expect(light / dark, name).toBeLessThan(1.35);
    }

    // Inside floating surfaces the light hover lightens the menus' beige instead (a 10% black
    // band read heavy, above all in the notification panel), but by the same threshold: a white
    // hover too faint to see would separate rows less than the dark theme's. Selection and the
    // danger row lighten too, each as far from the menu as its dark counterpart.
    const floating = { light: themeValue('--bg-floating', false), dark: themeValue('--bg-floating', true) };
    for (const [name, darkCounterpart] of [
      ['--bg-hover-floating', '--bg-hover'], ['--bg-selected-floating', '--accent-subtle'],
      ['--bg-danger-hover-floating', '--error-subtle'],
    ]) {
      expect(themeValue(name, true), name).toBe(themeValue(darkCounterpart, true));
      const over = (dark: boolean) => mix(themeValue(name, dark), floating[dark ? 'dark' : 'light']);
      const light = lstar(over(false)) - lstar(floating.light);
      const dark = lstar(over(true)) - lstar(floating.dark);
      expect(light, `${name} lightens the light menus`).toBeGreaterThan(0);
      expect(light / dark, name).toBeGreaterThan(0.9);
      expect(light / dark, name).toBeLessThan(1.35);
    }
    // The selected row stays apart from the hovered one by its tint, not only its lightness.
    expect(themeValue('--bg-selected-floating', false)).not.toBe(mix(themeValue('--bg-hover-floating', false), floating.light));
  });

  it('hands the floating hover and selection to every floating surface, not to the page', () => {
    // Every surface filled with --bg-floating, except the bars docked in the page (the player,
    // the pinned Archive bar), passes the floating hover down to its rows, buttons and Tailwind
    // hover:bg-[var(--bg-hover)] classes; the editor's index only when it floats, on a phone.
    const scope = index.match(/\n:is\(([^)]*)\) \{\s*--bg-hover: var\(--bg-hover-floating\);\s*\}/)?.[1];
    const scoped = new Set(scope?.split(',').map(selector => selector.trim()));
    const filled = new Set([...index.matchAll(/(?:^|\n)(\.[\w-]+) \{[^}]*background(?:-color)?: var\(--bg-floating\)/g)].map(([, selector]) => selector));
    for (const docked of ['.editor-player-dock', '.editor-toc-content']) filled.delete(docked);
    expect(filled.size).toBeGreaterThan(12);
    expect([...filled].filter(selector => !scoped.has(selector))).toEqual([]);
    expect(scoped.has('.editor-player-dock')).toBe(false);
    expect(rule('.editor-toc-content', '  ')).toMatch(/--bg-hover: var\(--bg-hover-floating\);/);
    expect(rule('.editor-toc-content .toc-item-active', '  ')).toMatch(/background: var\(--bg-selected-floating\) !important;/);
    // The page's index column keeps the page's selection.
    expect(rule('.toc-item-active')).toMatch(/background: var\(--accent-subtle\) !important;/);

    // Selected rows and the danger row inside menus take the floating tokens.
    for (const [selector, token] of [
      ['.kebab-item.is-active', 'selected'], ['.notification-filter.is-active', 'selected'],
      ['.player-speed-preset.is-active', 'selected'], ['.editor-image-toolbar-button.active', 'selected'],
      ['.phone-format-toggles .editor-button.is-active', 'selected'], ['.kebab-item.is-danger:hover', 'danger-hover'],
    ]) {
      expect(rule(selector), selector).toMatch(new RegExp(`background(?:-color)?: var\\(--bg-${token}-floating\\)`));
    }
    const select = componentSources.find(({ file }) => file.endsWith('CustomSelect.tsx'))!.source;
    expect(select).toContain("? 'bg-[var(--bg-selected-floating)] text-[var(--accent-text)] font-bold'");
    // The speed chips rest on the floating hover; theirs must not darken them again in the light theme.
    expect(index).toMatch(/:root:not\(\[data-theme="dark"\]\) \.player-round-btn:not\(\.is-plain\):hover,\s*:root:not\(\[data-theme="dark"\]\) \.player-speed-preset:not\(\.is-active\):hover \{\s*background: var\(--bg-surface\);/);
  });

  it('keeps text and status colours readable on menu rows, hovered, selected and unread, in both themes', () => {
    // On the light menus' beige the status texts sat at 4.3-4.9:1, and the darkening hover took
    // "Elimina" and "Apri Impostazioni" to 3.5-3.9:1; a notification's category badge on an
    // unread row's tint read at 3.3:1.
    const unreadTint = Number(rule('.notification-item::before')?.match(/color-mix\(in srgb, var\(--notification-tone\) (\d+)%/)?.[1]) / 100;
    expect(unreadTint).toBeGreaterThan(0);
    // The dark theme's tint under the hover, and its badges laid on the menu's grey.
    const darkHoveredTint = Number(rule(':root[data-theme="dark"] .notification-item.is-unread:hover::before')?.match(/opacity: ([\d.]+);/)?.[1]);
    expect(darkHoveredTint).toBeGreaterThan(0);
    expect(darkHoveredTint).toBeLessThan(1);
    expect(rule('.notification-category-badge')).toMatch(/background: var\(--badge-bg\);/);
    expect(rule(':root[data-theme="dark"] .notification-category-badge')).toMatch(/background: linear-gradient\(var\(--badge-bg\), var\(--badge-bg\)\), var\(--bg-floating\);/);
    const item = componentSources.find(({ file }) => file.endsWith('NotificationItem.tsx'))!.source;
    expect(item).toMatch(/className="notification-category-badge [^"]*"\s*style=\{getCategoryBadgeStyle\(/);
    const surfaces = ['--bg-base', '--bg-surface', '--bg-panel', '--bg-elevated', '--bg-input', '--bg-floating',
      '--header-bg', '--editor-chrome-bg', '--editor-toolbar-bg', '--card-queued-bg', '--glass-bg'];
    const tones = [['--success-text', '--success-subtle'], ['--warning-text', '--warning-subtle'],
      ['--error-text', '--error-subtle'], ['--accent-text', '--accent-subtle']] as const;
    for (const dark of [false, true]) {
      const mode = dark ? 'dark' : 'light';
      const floating = themeValue('--bg-floating', dark);
      const rows: Record<string, string> = {
        menu: floating,
        'hovered row': mix(themeValue('--bg-hover-floating', dark), floating),
        'selected row': mix(themeValue('--bg-selected-floating', dark), floating),
        'hovered danger row': mix(themeValue('--bg-danger-hover-floating', dark), floating),
      };
      // The dark theme's toolbar is the chrome behind it, not a surface of its own.
      for (const surface of surfaces.filter(name => !dark || token(darkTheme, name))) {
        const hex = themeValue(surface, dark);
        rows[surface] = hex;
        // The menus have the floating hover above; the page hover is for the page.
        if (surface !== '--bg-floating') rows[`hovered ${surface}`] = mix(themeValue('--bg-hover', dark), hex);
      }
      const text = ['--text-primary', '--text-secondary', '--text-muted'].map(name => [name, themeValue(name, dark)] as const);
      for (const [name, colour] of [...text, ...tones.map(([tone]) => [tone, themeValue(tone, dark)] as const)]) {
        for (const [row, background] of Object.entries(rows)) {
          expect(contrast(colour, background), `${mode} ${name} on ${row}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // A notification row in its tone, unread (at the tint's deepest point) or not, hovered or
      // not, with its own text and its tone's category badge on it. In the dark theme the tint and
      // the hover both lighten the row (3.6:1 for muted text, 3.6-4.4:1 for badges): there the tint
      // steps down under the hover, and badges lie on the menu's grey instead of on the row.
      const hoveredTint = unreadTint * (dark ? darkHoveredTint : 1);
      for (const [tone, subtle] of tones) {
        const colour = themeValue(tone, dark);
        for (const [state, base, tint] of [['resting', rows.menu, unreadTint], ['hovered', rows['hovered row'], hoveredTint]] as const) {
          for (const [read, row] of [['read', base], ['unread', mix(colour, base, tint)]] as const) {
            const where = `${mode} ${state} ${read} ${tone} notification`;
            for (const [name, hex] of [...text, [tone, colour] as const]) {
              expect(contrast(hex, row), `${name} on a ${where}`).toBeGreaterThanOrEqual(4.5);
            }
            const badge = mix(themeValue(subtle, dark), dark ? rows.menu : row);
            expect(contrast(colour, badge), `badge on a ${where}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it('writes primary buttons in white on a green dark enough for it, in both themes', () => {
    // The dark theme's primaries put white on the accent #5aa356: 3.1:1 ("Sfoglia file", "Salva",
    // "Copia documento"). Both themes now use a darker green under white text, hover included.
    for (const dark of [false, true]) {
      const text = themeValue('--btn-primary-text', dark);
      for (const fill of ['--btn-primary-bg', '--btn-primary-hover']) {
        expect(contrast(text, themeValue(fill, dark)), `${dark ? 'dark' : 'light'} ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
      // Pressing only scales; disabled primaries take the disabled tokens, like every button.
      expect(rule('.modal-action-button.is-primary:disabled')).toMatch(/background: var\(--btn-disabled-bg\);\s*color: var\(--btn-disabled-text\);/);
    }
    // Text in the primary's white sits on the primary's green; the accent green, lighter in the
    // dark theme, fills only icons, which need 3:1.
    const icons = new Set(['.dropzone-card:hover .dropzone-icon, .dropzone-card:focus-visible .dropzone-icon',
      '.dropzone-icon-wrap.is-live .dropzone-icon']);
    const offenders: string[] = [];
    for (const [, rawSelector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      if (/color: var\(--btn-primary-text\)/.test(body) && /background(?:-color)?: var\(--(?!btn-primary-)/.test(body) && !icons.has(selector)) {
        offenders.push(selector);
      }
    }
    expect(offenders).toEqual([]);
    expect(contrast(themeValue('--btn-primary-text', true), themeValue('--accent-bg', true))).toBeGreaterThanOrEqual(3);
    const share = componentSources.find(({ file }) => file.endsWith('ShareExportModal.tsx'))!.source;
    expect(share).not.toMatch(/background: 'var\(--accent-bg\)', color: 'var\(--btn-primary-text\)'/);
  });

  it('frames every floating surface in the light theme as clearly as the dark one does', () => {
    // A menu in #e9e5dc on the #f0ede6 header (1.07:1), with a 0.16 hairline and a 0.08 shadow,
    // read as part of the page, while the dark theme's menus stood out from everything.
    const header = token(lightTheme, '--editor-chrome-bg')!;
    const floating = token(lightTheme, '--bg-floating')!;
    expect(contrast(floating, header)).toBeGreaterThan(1.12);
    expect(contrast(floating, token(lightTheme, '--text-muted')!)).toBeGreaterThan(4.5);
    expect(Number(token(lightTheme, '--border-floating')!.match(/([\d.]+)\)$/)?.[1])).toBeGreaterThanOrEqual(0.3);
    // A shadow that lifts without a halo: a 32px blur at 0.26 read as a cloud round every menu,
    // and the player's menus, opening upwards, kept a 0.45 black one of their own.
    for (const name of ['--shadow-floating', '--shadow-floating-up']) {
      // Each layer is "x y blur [spread] rgba(...)".
      const shadows = token(lightTheme, name)!.split(/(?<=\)),\s*/).map(layer => ({
        blur: Number(layer.match(/-?\d+(?:px)?/g)![2].replace('px', '')),
        alpha: Number(layer.match(/([\d.]+)\)$/)![1]),
      }));
      expect(shadows.length, name).toBeGreaterThan(0);
      for (const { blur, alpha } of shadows) {
        expect(blur, name).toBeLessThanOrEqual(20);
        expect(alpha, name).toBeLessThanOrEqual(0.18);
      }
      expect(Math.max(...shadows.map(({ alpha }) => alpha)), name).toBeGreaterThanOrEqual(0.12);
    }
    expect(rule('.kebab-panel.player-menu')).toMatch(/box-shadow: var\(--shadow-floating-up\)/);
    // The dark theme keeps exactly the frame it had.
    expect(token(darkTheme, '--border-floating')).toBe('var(--border-subtle)');
    expect(token(darkTheme, '--shadow-floating')).toBe('var(--shadow-strong)');
    expect(token(darkTheme, '--shadow-floating-up')).toMatch(/^0 -10px 28px -14px rgb\(0 0 0 \/ 0\.45\)/);

    for (const selector of [
      '.kebab-panel', '.color-picker-panel', '.context-menu', '.editor-bubble-menu', '.link-panel',
      '.editor-link-card', '.sidebar-account-menu', '.select-dropdown', '.notification-dropdown-panel',
      '.find-bar-float', '.find-replace-dialog', '.editor-video-preview',
      '.folder-name-tooltip', '.archive-selection-bar', ['.editor-toc-content', '  '],
    ] as const) {
      const [name, indent] = typeof selector === 'string' ? [selector, ''] : selector;
      expect(rule(name, indent), name).toMatch(/background(?:-color)?: var\(--bg-floating\)/);
      expect(rule(name, indent), name).toMatch(/border: 1px solid var\(--border-floating\)/);
      expect(rule(name, indent), name).toMatch(/box-shadow: var\(--shadow-floating\)/);
    }
    expect(rule('.phone-format-sheet')).toMatch(/border-top: 1px solid var\(--border-floating\)/);
    // Docked bars keep their lighter shadow but share the frame.
    expect(rule('.editor-player-dock')).toMatch(/border: 1px solid var\(--border-floating\)/);
    expect(rule(".archive-sticky-toolbar[data-stuck='true']")).toMatch(/border-color: var\(--border-floating\)/);
  });

  it('keeps interface colours and shadows on the theme tokens', () => {
    // Hovers between 0.04 and 0.08, dark surfaces copied as #202020/#252525, a slate-tinted
    // button shadow and a blue table selection each drifted from the rest of the app. A literal
    // colour now needs a reason of its own: content, a mask, or a mix of a user's colour.
    const allowed = new Set([
      // The document page mirrors Google Docs: white paper, black text, Docs-blue links.
      '.editor-page', ':root[data-theme="dark"] .editor-page', '.tiptap-editor', '.tiptap-editor a',
      '.editor-page-container, :root[data-theme="dark"] .editor-page-container',
      ':root[data-theme="dark"] .editor-page-container',
      // Find highlights must read on any text colour the document uses.
      '.search-highlight', '.search-highlight-active',
      ':root[data-theme="dark"] .search-highlight', ':root[data-theme="dark"] .search-highlight-active',
      // Drawn over arbitrary content or colours: images, the logo, the progress shimmer.
      '.editor-image-resize-handle', '.app-logo', '.phase-segment-fill.is-live::after',
      '.phase-segment-fill.is-live::before', '.phase-segment-fill.is-settled::after',
      // A user's folder colour, mixed towards black or white for legibility.
      '.folder-indicator-chip', '[data-theme="dark"] .folder-indicator-chip',
      // The red slash of the "no colour" swatch, and the white knob every switch shares.
      '.phone-format-swatch.is-none', '.queue-switch-thumb',
      // White rings that keep image handles visible on any picture; the red snapping guide.
      '.editor-image-resize-preview', '.editor-image-node .editor-image-resize-handles',
      '.editor-image-alignment-guide',
      // Dark-theme base tints the light theme overrides with a token.
      '.premium-badge, .helper-chip, .action-chip, .status-pill', '.editor-toolbar',
    ]);
    const stripVars = (value: string) => {
      let out = value;
      for (let previous = ''; previous !== out;) {
        previous = out;
        out = out.replace(/var\((?:[^()]|\([^()]*\))*\)/g, '');
      }
      return out;
    };
    const offenders: string[] = [];
    for (const [, rawSelector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      for (const declaration of body.split(';')) {
        const [property, ...rest] = declaration.split(':');
        const name = property.trim();
        if (!rest.length || name.startsWith('--') || /mask-image|transition|animation/.test(name)) continue;
        if (/#[0-9a-f]{3,8}\b|rgba?\(|\b(?:white|black)\b/i.test(stripVars(rest.join(':'))) && !allowed.has(selector)) {
          offenders.push(`${selector} { ${name} }`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('rounds every corner from one radius scale, shared with Tailwind', () => {
    // Thirteen hand-written radii (2 to 28px, 10px cards beside 12px ones) made similar things
    // round differently. The scale lives once, in @theme, so rounded-lg and the CSS agree.
    const scale = index.match(/@theme static \{([^}]*)\}/)?.[1] ?? '';
    expect(Object.fromEntries([...scale.matchAll(/--radius-(\w+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]))).toEqual({
      xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '12px', '2xl': '16px',
    });
    expect(token(lightTheme, '--radius-card')).toBe('var(--radius-xl)');
    expect(token(lightTheme, '--radius-panel')).toBe('var(--radius-2xl)');

    // Concentric with what they hold: the radius is the content's plus the inset around it.
    const concentric = new Set(['.archive-sticky-toolbar', '.editor-player-dock', '.archive-selection-bar']);
    const offenders: string[] = [];
    for (const [, rawSelector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      for (const [, value] of body.matchAll(/border(?:-[a-z-]+)?-radius:\s*([^;]+);/g)) {
        const literal = value.replace(/!important/, '').split(/\s+/)
          .filter(part => part && !part.startsWith('var(--radius-') && !['0', '50%', 'inherit'].includes(part));
        if (literal.length && !concentric.has(selector)) offenders.push(`${selector}: ${value.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
    // Cards side by side round alike.
    for (const card of ['.queue-card', '.archive-session-card', '.folder-card', '.dashboard-section']) {
      expect(rule(card), card).toMatch(/border-radius: var\(--radius-card\)/);
    }
  });

  it('sizes interface text from one type scale, shared with Tailwind', () => {
    // Twenty-five sizes, many half a pixel apart (11, 11.2, 11.52, 12, 12.16, 12.48, 12.8...),
    // and an Archive title at 28px semibold beside the 32px bold of every other page.
    const scale = index.match(/@theme static \{([^}]*)\}/)?.[1] ?? '';
    const px = Object.fromEntries([...scale.matchAll(/--text-([\w-]+):\s*([\d.]+)rem;/g)].map(([, k, v]) => [k, Number(v) * 16]));
    expect(px).toEqual({ micro: 10, caption: 11, xs: 12, label: 13, sm: 14, base: 16, lg: 18, '2xl': 24, title: 32 });

    // The hero percentage is a one-off display figure; web inputs need 16px so iOS never zooms.
    const allowed = new Set(['.processing-hero-percent']);
    const offenders: string[] = [];
    for (const [, rawSelector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      for (const [, value] of body.matchAll(/font-size:\s*([^;]+);/g)) {
        // Document sizes are var(--document-*) or points, like Google Docs.
        if (/^var\(--(?:text|document)-|^[\d.]+pt$/.test(value.trim()) || allowed.has(selector)) continue;
        if (selector.startsWith(':root[data-host="web"]') && value.startsWith('16px')) continue;
        offenders.push(`${selector}: ${value.trim()}`);
      }
    }
    // The "10" inside the player's skip icons is part of the glyph, sized with it.
    for (const { file, source } of componentSources) {
      for (const match of source.matchAll(/\btext-\[[\d.]+(?:px|rem)\]|fontSize:\s*['"]?\d[^,}]*/g)) {
        if (!(file.endsWith('AudioPlayer.tsx') && match[0] === 'text-[8px]')) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
    const archiveTitle = componentSources.find(({ file }) => file.endsWith('ArchiveLayout.tsx'))!.source;
    expect(archiveTitle).toMatch(/<h1 className="page-title /);
  });

  it('spaces interface lines from one leading scale, shared with Tailwind', () => {
    // Nineteen line-heights (1, 1.15, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 20px, 16px...) beside the
    // five leading-* classes. The document page keeps the leading of its Docs/.docx export.
    const scale = index.match(/@theme static \{([^}]*)\}/)?.[1] ?? '';
    const leading = Object.fromEntries([...scale.matchAll(/--leading-([\w-]+):\s*([\d.]+);/g)].map(([, k, v]) => [k, Number(v)]));
    expect(leading).toEqual({ none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625 });

    const caption = String(DOCUMENT_FORMATTING.caption.lineHeight);
    const allowed = new Set([
      // Image frames drop the inline gap under the picture.
      '.editor-image-node: 0',
      '.editor-image-drag-preview: 0',
      // The image caption is document text, exported with this line spacing.
      `.editor-image-node .editor-image-caption: ${caption}`,
      `.editor-image-drag-preview .editor-image-caption: ${caption}`,
      // Fixed-size boxes: the 32px context-menu row, the two-line 40px folder title, the 16px count pill.
      '.kebab-item.editor-context-menu-item: 20px',
      '.folder-card-title: 20px',
      '.notification-filter-count: 16px',
    ]);
    const offenders: string[] = [];
    for (const [, rawSelector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      for (const [, raw] of body.matchAll(/line-height:\s*([^;]+);/g)) {
        const value = raw.trim();
        if (/^var\(--(?:leading|document)-/.test(value) || allowed.has(`${selector}: ${value}`)) continue;
        offenders.push(`${selector}: ${value}`);
      }
    }
    const main = { file: '../main.tsx', source: readFileSync(new URL('./main.tsx', import.meta.url), 'utf8') };
    for (const { file, source } of [...componentSources, main]) {
      // Tailwind's leading-[…] and numeric leading-6 sit outside the scale.
      for (const match of source.matchAll(/\bleading-(?!(?:none|tight|snug|normal|relaxed)\b)[\w[\].%-]+/g)) offenders.push(`${file}: ${match[0]}`);
      for (const [, raw] of source.matchAll(/lineHeight:\s*([^,}]+)/g)) {
        const value = raw.trim();
        // Sidebar icon wrappers drop the inline gap under the SVG, like the image frames.
        if (/^'var\(--leading-/.test(value) || (value === '0' && /(?:NavSidebar|SidebarAccount)\.tsx$/.test(file))) continue;
        offenders.push(`${file}: lineHeight ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives Tailwind text sizes a line-height from the leading scale', () => {
    // text-xs…text-2xl carried Tailwind's own leading (1.333, 1.429, 1.556…), off the scale.
    const scale = index.match(/@theme static \{([^}]*)\}/)?.[1] ?? '';
    const sources = [...componentSources.map(({ source }) => source), readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')].join('\n');
    const tailwindSizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
    const used = tailwindSizes.filter(size => new RegExp(`(?:^|[\\s"'\`])text-${size}(?=[\\s"'\`])`).test(sources));
    expect(used).toEqual(expect.arrayContaining(['xs', 'sm', 'base', 'lg', '2xl']));
    const offScale = used.filter(size => !/^var\(--leading-(?:none|tight|snug|normal|relaxed)\)$/.test(token(scale, `--text-${size}--line-height`) ?? ''));
    expect(offScale).toEqual([]);
    // A size/leading shorthand (text-sm/6) would bypass the scale again.
    expect(sources.match(/\btext-(?:micro|caption|label|title|xs|sm|base|lg|[2-9]?xl)\/[\w[\].]+/g) ?? []).toEqual([]);
  });

  it('moves the interface with the durations and curves of motion.ts', () => {
    // Eighteen durations (80 to 480ms, 140/150/160/170/180 side by side), the generic `ease` in
    // 166 transitions and EASE_OUT copied by hand, while motion.ts names three durations and one
    // decelerating curve. Choreographed animations keep their own timing, not their own curves.
    for (const [name, seconds] of Object.entries(DURATION)) {
      expect(token(lightTheme, `--duration-${name}`), name).toBe(`${Math.round(seconds * 1000)}ms`);
    }
    expect(token(lightTheme, '--ease-out')).toBe(`cubic-bezier(${EASE_OUT.join(', ')})`);
    expect(token(lightTheme, '--ease-in')).toBe(`cubic-bezier(${EASE_IN.join(', ')})`);

    const offenders: string[] = [];
    for (const [, rawSelector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      for (const [, property, value] of body.matchAll(/(transition[a-z-]*|animation[a-z-]*)\s*:\s*([^;]+);/g)) {
        const literalCurve = /cubic-bezier\(|(?<![-\w])ease(?:-out)?(?![-\w])/.test(value);
        const literalDuration = property.startsWith('transition') && /(?<![\w.(-])(?!0m?s\b)\d*\.?\d+m?s\b/.test(value);
        if (literalCurve || literalDuration) offenders.push(`${selector} { ${property}: ${value.trim().replace(/\s+/g, ' ')} }`);
      }
    }
    // The logo, the sidebar slide, the processing hand-off and the phone sheet are choreographed.
    const choreographed = ['BrandLogo.tsx', 'NavSidebar.tsx', 'ProcessingStatusBanner.tsx', 'PhoneFormatSheet.tsx'];
    for (const { file, source } of componentSources) {
      if (/ease:\s*'easeOut'/.test(source)) offenders.push(`${file}: ease 'easeOut'`);
      if (choreographed.some(name => file.endsWith(name))) continue;
      for (const match of source.matchAll(/\bduration:\s*(\d*\.?\d+)/g)) {
        if (Number(match[1]) !== 0) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('builds every button from one set of variants and sizes', () => {
    // 32 button classes had six heights for the same secondary role (32 to 44px), three shapes
    // and two weights, and the empty player's slot jumped 2px as its button changed variant.
    expect(['sm', 'md', 'lg'].map(size => token(lightTheme, `--control-height-${size}`))).toEqual(['32px', '36px', '40px']);
    expect(['xs', 'sm', 'md', 'lg'].map(size => token(lightTheme, `--icon-button-${size}`))).toEqual(['28px', '32px', '36px', '42px']);
    expect(token(lightTheme, '--button-weight')).toBe('600');
    // Every top-level rule for a selector, since a class may be set in several places.
    const rules = (selector: string) => [...index.matchAll(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]'=]/g, '\\$&')} \\{([^}]*)\\}`, 'g'))]
      .map(([, body]) => body).join(';');

    for (const button of [
      '.settings-pill-button', '.modal-action-button', '.processing-stop-button', '.app-button-secondary.is-settings-action',
      '.compact-button', '.archive-action-button', '.dropzone-browse-button', '.completed-open-button', '.queue-text-button',
      '.link-apply-btn', '.find-replace-dialog-btn',
    ]) {
      const body = rules(button);
      expect(body, button).toMatch(/(?:min-)?height: var\(--control-height-(?:sm|md|lg)\)/);
      expect(body, button).not.toMatch(/(?:min-)?height: (?!var\()/);
      expect(body, button).toMatch(/font-weight: var\(--button-weight\)/);
      expect(body, button).not.toMatch(/border-radius: var\(--radius-(?!pill)/);
    }
    // The fields beside them line up on the same heights.
    // A fixed height without vertical padding, so the phone's 16px anti-zoom text (the web host's
    // rule) cannot push one off the scale: the padded min-height settings field grew to 38px.
    for (const field of [
      '.modal-card .app-input', '.app-input.is-settings-input', '.app-input.is-settings-input.setup-key-input', '.search-pill-input', '.link-input',
      '.find-bar-input', '.find-replace-dialog-input',
    ]) {
      const body = rules(field);
      expect(body, field).toMatch(/(?:^|[;\s])height: var\(--control-height-(?:sm|md|lg)\)/);
      expect(body, field).not.toMatch(/min-height:/);
      for (const [, padding] of body.matchAll(/(?:^|[;\s])padding(?:-block|-top|-bottom)?:\s*([^;]+)/g)) {
        expect(padding.trim().split(/\s+/)[0], `${field} vertical padding`).toBe('0');
      }
    }
    expect(index).toMatch(/@media \(max-width: 640px\) and \(pointer: coarse\) \{\s*:root\[data-host="web"\] :is\(input:not\([^)]*\), textarea, select\) \{\s*font-size: 16px !important;\s*\}\s*\}/);
    for (const icon of ['.icon-button', '.compact-icon-button', '.modal-icon-button', '.editor-button', '.editor-toc-btn', '.editor-bubble-btn', '.find-bar-btn', '.drag-handle-btn']) {
      const body = rules(icon);
      expect(body, icon).toMatch(/width: var\(--icon-button-(?:xs|sm|md|lg)\)/);
      expect(body, icon).toMatch(/border-radius: var\(--radius-lg\)/);
    }
    // The queue's ghost actions wear .compact-button alone, so it carries its own look.
    expect(rules('.compact-button')).toMatch(/display: inline-flex;[\s\S]*background: transparent;/);
    // Classes no component wears stay gone: five folded into the variants, then the old
    // premium buttons, toolbar selects, zoom control, left TOC, chips and banners.
    for (const dead of [
      'toast-dismiss-btn', 'mini-icon-button', 'toc-left-btn', 'editor-image-toolbar-button-sm', 'btn-warning-filled',
      'premium-button', 'queue-stop-button', 'icon-btn-theme', 'icon-btn-settings', 'icon-btn-console', 'console-flash',
      'hover-danger', 'is-danger-hover', 'premium-panel-strong', 'brand-mark', 'player-menu-row', 'stat-chip',
      'processing-chip', 'canceling-chip', 'soft-divider', 'hide-scrollbar', 'app-textarea', 'editor-select',
      'font-family-select', 'font-size-select', 'heading-select', 'open-up', 'dropdownPopUp', 'toc-left-sidebar',
      'toc-left-header', 'toc-left-nav', 'editor-image-toolbar-divider', 'editor-image-action', 'image-layout-divider',
      'hg-svg', 'hg-sand-t', 'hg-sand-b', 'editor-zoom-control', 'editor-zoom-display', 'border-b-subtle',
      'notice-banner', 'badge-success', 'badge-warning', 'iframe-wrapper',
    ]) {
      expect(styles, dead).not.toContain(dead);
    }
    // These two are the tails of live classes (.editor-context-menu-item, .dashboard-section-title).
    for (const dead of ['context-menu-item', 'section-title']) {
      expect(styles, dead).not.toMatch(new RegExp(`(?<![\\w-])${dead}(?![\\w-])`));
    }

    // A button sized with Tailwind padding alone drifts off the scale; size it with the tokens.
    // The storage-choice tiles are cards, not buttons.
    const offenders: string[] = [];
    for (const { file, source } of componentSources) {
      if (file.endsWith('WebStorageChoiceModal.tsx')) continue;
      for (const [, className] of source.matchAll(/<button\b[^>]*?className="([^"]*\brounded-[^"]*)"/gs)) {
        if (/(?:^|\s)p[xy]?-\d/.test(className) && !/var\(--(?:control-height|icon-button)-/.test(className)) {
          offenders.push(`${file}: ${className.slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('shows keyboard focus with the one ring of theme.css, in both themes', () => {
    // Four focus styles had drifted apart: 3px halos in two greens (at 18-32% opacity, under 3:1
    // on every surface), 2px outlines in two other greens, red, amber and processing halos, and
    // cards and fields that showed no ring at all. One outline now comes from the tokens.
    expect(['width', 'offset'].map(part => token(lightTheme, `--focus-ring-${part}`))).toEqual(['2px', '2px']);
    expect(token(lightTheme, '--focus-ring-inset')).toBe('calc(-1 * var(--focus-ring-width))');
    expect(token(lightTheme, '--focus-ring')).toBe('var(--focus-ring-width) solid var(--focus-ring-color)');
    // The dark ring follows its colour token instead of being a second definition.
    expect(darkTheme).not.toContain('--focus-ring');

    // At least 3:1 against every surface a control sits on, in both themes.
    const value = (name: string, dark: boolean): string | undefined => {
      const raw = (dark ? token(darkTheme, name) : undefined) ?? token(lightTheme, name);
      const reference = raw?.match(/^var\((--[\w-]+)\)$/)?.[1];
      return reference ? value(reference, dark) : raw;
    };
    const surfaces = ['--bg-base', '--bg-surface', '--bg-panel', '--bg-elevated', '--bg-input', '--bg-floating',
      '--header-bg', '--editor-chrome-bg', '--editor-toolbar-bg', '--card-queued-bg', '--glass-bg'];
    for (const dark of [false, true]) {
      const ring = value('--focus-ring-color', dark)!;
      // The dark toolbar is the chrome behind it; the document page has a rule of its own.
      const page = rule(dark ? ':root[data-theme="dark"] .editor-page' : '.editor-page')?.match(/background: (#[0-9a-f]{6});/i)?.[1];
      const colours = [...surfaces.filter(name => !dark || token(darkTheme, name)).map(name => value(name, dark)!), page!];
      for (const surface of [ring, ...colours]) expect(surface).toMatch(/^#[0-9a-f]{6}$/i);
      for (const surface of colours) {
        expect(contrast(ring, surface), `${dark ? 'dark' : 'light'} ring on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }

    // Every control takes the ring from one rule; mouse focus shows none (:focus-visible).
    expect(rule(':focus-visible')).toMatch(/^\s*outline: var\(--focus-ring\);\s*outline-offset: var\(--focus-ring-offset\);\s*$/);
    // Rules may move the ring inside (inset) where a container clips it, never restyle it.
    // No ring: the document page, whose caret shows focus, and a radio whose framing choice
    // card carries the ring. Outlines that are not focus: the active find match, an image resizing.
    const noRing = new Set(['.tiptap-editor:focus-visible', '.settings-choice input:focus-visible']);
    const otherOutlines = new Set(['.search-highlight-active', '.editor-image-resize-preview']);
    const offenders: string[] = [];
    for (const [, rawSelector, body] of [styles, stylesheet('./web/pages/privacy.css')].join('\n').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rawSelector.trim().replace(/\s+/g, ' ');
      const focus = selector.includes(':focus');
      for (const declaration of body.split(';')) {
        const [property, ...rest] = declaration.split(':');
        const name = property.trim();
        const declared = rest.join(':').trim();
        if (!rest.length || name.startsWith('--')) continue;
        const restyled = name === 'outline'
          ? !(focus && declared === 'var(--focus-ring)') && !(declared === 'none' && noRing.has(selector)) && !otherOutlines.has(selector)
          : name === 'outline-offset'
            ? !/^var\(--focus-ring-(?:offset|inset)\)$/.test(declared)
            : name.startsWith('outline-')
              ? !otherOutlines.has(selector)
              // A box-shadow spread drawn as a ring, or a *-ring halo token, is a second focus style.
              : focus && ((name === 'box-shadow' && /(?:^|,)\s*0 0 0 [1-9]/.test(declared)) || /var\(--(?!focus-ring)[\w-]*-ring\)/.test(declared));
        if (restyled) offenders.push(`${selector} { ${name}: ${declared} }`);
      }
    }
    expect(offenders).toEqual([]);

    // Components neither draw their own ring with Tailwind or inline styles nor remove the shared one.
    const sources = readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.tsx') && !file.includes('.test.'))
      .map(file => ({ file, source: readFileSync(new URL(`./${file.replace(/\\/g, '/')}`, import.meta.url), 'utf8') }));
    expect(sources.length).toBeGreaterThan(50);
    const sourceOffenders = sources.flatMap(({ file, source }) => [
      ...source.matchAll(/\b(?:focus|focus-visible|focus-within):(?:outline|ring)\S*|\boutline-(?:none|hidden|offset|\d|\[)\S*|\bring-(?:[1-9]|offset|inset|\[)\S*|\boutline(?:Offset|Color|Width|Style)?:\s*['`{]/g),
    ].map(match => `${file}: ${match[0]}`));
    expect(sourceOffenders).toEqual([]);
  });

  it('keeps every text grey readable on every surface, in warm greys, in both themes', () => {
    // Faint text measured 3.0-4.0:1 in the light theme and 2.9-3.4:1 in the dark one, lowest on
    // the menus, and the dark theme's text greys were Tailwind's blue-greys over neutral surfaces.
    const value = (name: string, dark: boolean): string | undefined => {
      const raw = (dark ? token(darkTheme, name) : undefined) ?? token(lightTheme, name);
      const reference = raw?.match(/^var\((--[\w-]+)\)$/)?.[1];
      return reference ? value(reference, dark) : raw;
    };
    const surfaces = ['--bg-base', '--bg-surface', '--bg-panel', '--bg-elevated', '--bg-input', '--bg-floating',
      '--header-bg', '--editor-chrome-bg', '--editor-toolbar-bg', '--card-queued-bg', '--glass-bg'];
    const lstar = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
    };
    for (const dark of [false, true]) {
      const mode = dark ? 'dark' : 'light';
      const page = rule(dark ? ':root[data-theme="dark"] .editor-page' : '.editor-page')?.match(/background: (#[0-9a-f]{6});/i)?.[1];
      const colours = [...surfaces.filter(name => !dark || token(darkTheme, name)).map(name => value(name, dark)!), page!];
      const text = ['--text-primary', '--text-secondary', '--text-muted', '--text-faint'].map(name => [name, value(name, dark)!] as const);
      const icon = value('--icon-faint', dark)!;
      for (const colour of [...colours, ...text.map(([, hex]) => hex), icon]) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      for (const surface of colours) {
        for (const [name, hex] of text) {
          expect(contrast(hex, surface), `${mode} ${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        // Icons and other marks that are not text: 3:1.
        expect(contrast(icon, surface), `${mode} --icon-faint on ${surface}`).toBeGreaterThanOrEqual(3);
      }
      // Each step of the hierarchy stays visibly apart; the icon grey reads fainter than any text.
      const steps = [...text.slice(0, 3).map(([, hex]) => hex), icon].map(lstar);
      for (let i = 1; i < steps.length; i += 1) {
        expect(Math.abs(steps[i] - steps[i - 1]), `${mode} text step ${i}`).toBeGreaterThanOrEqual(8);
      }
      expect(dark ? steps[3] < steps[2] : steps[3] > steps[2], `${mode} --icon-faint is fainter than muted`).toBe(true);

      // The same under the states that tint a row: the hover on any surface (muted sat at 3.9:1
      // on a hovered light menu row) and the deepest point of an unread notification's tint, in
      // each of its tones (about 4.1:1 in the light theme, 4.1 in the dark one).
      const blend = (rgba: string, hex: string) => {
        const [r, g, b, alpha] = rgba.match(/[\d.]+/g)!.map(Number);
        return `#${[r, g, b].map((c, i) => Math.round(c * alpha + parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - alpha))
          .toString(16).padStart(2, '0')).join('')}`;
      };
      const hover = value('--bg-hover', dark)!;
      expect(hover).toMatch(/^rgba\(/);
      for (const surface of surfaces.filter(name => !dark || token(darkTheme, name)).map(name => value(name, dark)!)) {
        for (const [name, hex] of text) {
          expect(contrast(hex, blend(hover, surface)), `${mode} ${name} on hovered ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      const unreadTint = rule('.notification-item::before')?.match(/color-mix\(in srgb, var\(--notification-tone\) (\d+)%/)?.[1];
      expect(Number(unreadTint)).toBeGreaterThan(0);
      for (const tone of ['--accent-text', '--success-text', '--warning-text', '--error-text']) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(value(tone, dark)!.slice(i, i + 2), 16));
        const tinted = blend(`rgba(${r}, ${g}, ${b}, ${Number(unreadTint) / 100})`, value('--bg-floating', dark)!);
        for (const [name, hex] of text) {
          expect(contrast(hex, tinted), `${mode} ${name} on an unread ${tone} notification`).toBeGreaterThanOrEqual(4.5);
        }
      }

      // Neutral or warm, like the light theme's greys and the dark surfaces: never bluer than red.
      for (const name of ['--text-primary', '--text-secondary', '--text-muted', '--icon-faint', '--console-text',
        '--console-muted', '--console-heading', '--btn-disabled-text', '--btn-disabled-bg']) {
        const colour = value(name, dark)!;
        const [r, , b] = colour.startsWith('#')
          ? [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16))
          : colour.match(/[\d.]+/g)!.map(Number);
        expect(b, `${mode} ${name} is not a blue-grey`).toBeLessThanOrEqual(r);
      }
    }
    // Faint text is muted text: there is no readable step below muted on the light menus.
    expect(token(lightTheme, '--text-faint')).toBe('var(--text-muted)');
    expect(token(darkTheme, '--text-faint')).toBeUndefined();

    // The icon grey stays on icons.
    const iconRules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => body.includes('var(--icon-faint)')).map(([, selector]) => selector.trim());
    expect(iconRules).toEqual(['.search-pill-icon', '.search-pill-clear']);

    // Tailwind's gray and slate text greys stay out of the interface, written by hand or as fallbacks.
    const coldGreys = /#(?:e5e7eb|d1d5db|9ca3af|6b7280|4b5563|374151|e2e8f0|cbd5e1|94a3b8|64748b|475569|334155)\b/i;
    // Content, not interface: a user's neutral folder colour, and the caption grey pasted into Docs.
    const contentColours = new Set(['archiveFolders.ts', 'components/archive/types.ts', 'editorClipboard.ts']);
    const sources = readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
      .map(file => file.replace(/\\/g, '/'))
      .filter(file => /\.(?:tsx?|css)$/.test(file) && !file.includes('.test.') && !contentColours.has(file));
    expect(sources).toEqual(expect.arrayContaining(['main.tsx', 'web/noticePage.ts', 'theme.css', 'index.css']));
    const coldOffenders = sources.filter(file => coldGreys.test(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')));
    expect(coldOffenders).toEqual([]);
  });

  it('stacks every window-wide layer by name, menus on top', () => {
    // Menus sat at 9999 while the editor's context menu sat at 50, level with the full-page
    // editor and Settings: it showed only because it came later in the page. Layers that cover
    // the window now take a named level; z-index inside one component stays local and small.
    const order = ['sticky', 'sidebar', 'dismiss-layer', 'dialog', 'modal', 'tooltip', 'inline-toolbar', 'drag', 'sheet', 'popover']
      .map(name => Number(token(lightTheme, `--z-${name}`)));
    expect(order.every(Number.isFinite)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);

    const offenders: string[] = [];
    for (const [, rawSelector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const value = body.match(/z-index:\s*(-?\d+)\s*;/)?.[1];
      if (value && Number(value) >= 100) offenders.push(`${rawSelector.trim()}: ${value}`);
    }
    for (const { file, source } of componentSources) {
      for (const match of source.matchAll(/zIndex:\s*(\d+)|\bz-\[(\d+)\]|className="[^"]*\bfixed\b[^"]*\bz-(\d+)\b/g)) {
        offenders.push(`${file}: ${match[0].slice(-40)}`);
      }
    }
    expect(offenders).toEqual([]);

    for (const [selector, layer] of [
      ['.editor-fullpage', 'dialog'], ['.drop-overlay', 'modal'], ['.archive-sticky-toolbar', 'sticky'],
      ['.folder-name-tooltip', 'tooltip'], ['.editor-bubble-menu', 'inline-toolbar'], ['.phone-format-sheet', 'sheet'],
      ['.editor-link-card', 'popover'], ['.editor-video-preview', 'popover'],
    ]) {
      expect(rule(selector), selector).toMatch(new RegExp(`z-index: var\\(--z-${layer}\\)`));
    }
    const contextMenu = componentSources.find(({ file }) => file.endsWith('EditorContextMenu.tsx'))!.source;
    expect(contextMenu).toContain('z-[var(--z-popover)]');
  });

  it('keeps Tailwind palette colours out of the components', () => {
    const offenders = componentSources.flatMap(({ file, source }) => {
      return [...source.matchAll(/\b(?:bg|text|border|ring|divide|fill|stroke|from|to)-(?:black|gray|slate|zinc|neutral|stone|red|green|blue|yellow|amber|emerald|orange|indigo|purple|pink|rose|sky|teal|cyan|lime|violet|fuchsia)(?:-\d{2,3})?\b/g)]
        .map(match => `${file}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });

  it('draws the player and the pinned Archive bar solid, like everything else: no glass', () => {
    expect(index).not.toMatch(/backdrop-filter:\s*blur\(14px\)/);
    expect(index).toMatch(/\.archive-sticky-toolbar\[data-stuck='true'\] \{[^}]*background: var\(--bg-floating\);/);
  });

  it('keeps every animation with reduced motion turned on, like MotionConfig in App.tsx', () => {
    expect(index).not.toContain('prefers-reduced-motion');
  });
});
