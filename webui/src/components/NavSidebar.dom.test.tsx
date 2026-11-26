import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';
import { NavSidebar } from './NavSidebar';

afterEach(() => {
  setHostCapabilities(DEFAULT_CAPABILITIES);
  delete window.pywebview;
});

function renderSidebar(overrides: Partial<Parameters<typeof NavSidebar>[0]> = {}) {
  return render(<NavSidebar {...sidebarProps(overrides)} />);
}

function sidebarProps(overrides: Partial<Parameters<typeof NavSidebar>[0]> = {}) {
  return {
    activePage: 'queue' as const,
    setActivePage: vi.fn(),
    apiReady: true,
    bridgeDelayed: false,
    hasApiKey: true,
    isApiKeyValid: true,
    appState: 'idle' as const,
    themeMode: 'light' as const,
    setThemeMode: vi.fn(),
    setIsSettingsOpen: vi.fn(),
    unreadNotificationsCount: 0,
    isNotificationsOpen: false,
    setIsNotificationsOpen: vi.fn(),
    shakeBell: false,
    ...overrides,
  };
}

describe('NavSidebar badges', () => {
  it('shows no badge while idle with nothing pending', () => {
    const { container } = renderSidebar();
    expect(container.querySelector('.sidebar-badge')).toBeNull();
  });

  it('marks each pending state with the shared badge on its own button', () => {
    renderSidebar({ appState: 'processing', unreadNotificationsCount: 2 });

    const cases = [
      ['Dashboard', 'processing'],
      ['Apri notifiche', 'alert'],
    ] as const;
    for (const [button, tone] of cases) {
      const badge = screen.getByTestId(`sidebar-badge-${tone}`);
      expect(screen.getByRole('button', { name: button }).contains(badge)).toBe(true);
      expect(badge.className).toBe(`sidebar-badge tone-${tone}`);
      // One halo on the shared beat replaces the old per-badge animate-ping.
      expect(badge.querySelector('.sidebar-badge-halo')).not.toBeNull();
    }
    expect(document.querySelector('.animate-ping')).toBeNull();
  });

  it('opens the feedback window from the sidebar in web builds with Sentry', async () => {
    setHostCapabilities({ reportByEmail: false });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Segnala un problema' }));
    const dialog = await screen.findByRole('dialog', { name: 'Segnala un problema' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

});

describe('NavSidebar footer', () => {
  it('keeps theme, notifications, report and settings, with the settings last and no console', () => {
    renderSidebar();
    const footer = screen.getByRole('button', { name: 'Apri impostazioni' }).closest('nav')!;
    const names = Array.from(footer.querySelectorAll('button')).map(button => button.getAttribute('aria-label'));
    expect(names.slice(-4)).toEqual(['Tema scuro', 'Apri notifiche', 'Segnala un problema', 'Apri impostazioni']);
    expect(screen.queryByRole('button', { name: 'Mostra console' })).toBeNull();
  });

  it('gives the theme toggle the same animation class as the editor one', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Tema scuro' }).classList.contains('theme-toggle-btn')).toBe(true);
    expect(screen.getByRole('button', { name: 'Apri notifiche' }).classList.contains('theme-toggle-btn')).toBe(false);
  });

  it('animates the theme icon in only after a switch, not when the sidebar first shows', () => {
    const { rerender } = renderSidebar();
    const first = screen.getByRole('button', { name: 'Tema scuro' }).querySelector('svg')!;
    expect(first.classList.contains('lucide-moon')).toBe(true);
    expect(first.classList.contains('is-entering')).toBe(false);

    // Any other re-render leaves the icon on screen as it is.
    rerender(<NavSidebar {...sidebarProps({ unreadNotificationsCount: 1 })} />);
    expect(screen.getByRole('button', { name: 'Tema scuro' }).querySelector('svg')!.classList.contains('is-entering')).toBe(false);

    rerender(<NavSidebar {...sidebarProps({ themeMode: 'dark' })} />);
    const swapped = screen.getByRole('button', { name: 'Tema chiaro' }).querySelector('svg')!;
    expect(swapped.classList.contains('lucide-sun')).toBe(true);
    expect(swapped.classList.contains('is-entering')).toBe(true);
  });

  it('shows nothing about the Gemini key while it is ready, nor during the short wait for the host', () => {
    for (const props of [{}, { apiReady: false }, { appState: 'processing' as const }]) {
      const { unmount } = renderSidebar(props);
      const settings = screen.getByRole('button', { name: 'Apri impostazioni' });
      expect(settings.querySelector('.sidebar-badge')).toBeNull();
      expect(settings.getAttribute('aria-description')).toBeNull();
      // The old "API pronta" dot beside the tools is gone.
      expect(screen.queryByLabelText('API pronta')).toBeNull();
      unmount();
    }
  });

  it('marks the settings gear when the Gemini key needs attention, keeping its name', () => {
    const cases = [
      [{ hasApiKey: false, isApiKeyValid: false }, 'warning', 'manca la chiave API'],
      [{ isApiKeyValid: false }, 'warning', 'chiave API non valida'],
      [{ apiReady: false, bridgeDelayed: true }, 'alert', 'connessione in ritardo'],
    ] as const;
    for (const [props, tone, problem] of cases) {
      const { unmount } = renderSidebar(props);
      const settings = screen.getByRole('button', { name: 'Apri impostazioni' });
      const badge = within(settings).getByTestId(`sidebar-badge-${tone}`);
      expect(badge).toBeTruthy();
      expect(settings.getAttribute('aria-description')).toBe(`Attenzione: ${problem}`);
      fireEvent.mouseEnter(settings.parentElement!);
      expect(screen.getByText(`Impostazioni: ${problem}`)).toBeTruthy();
      unmount();
    }
  });
});
