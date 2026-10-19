import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavSidebar } from './NavSidebar';

function renderSidebar(overrides: Partial<Parameters<typeof NavSidebar>[0]> = {}) {
  const props = {
    activePage: 'queue' as const,
    setActivePage: vi.fn(),
    apiReady: true,
    bridgeDelayed: false,
    hasApiKey: true,
    isApiKeyValid: true,
    appState: 'idle' as const,
    themeMode: 'light' as const,
    setThemeMode: vi.fn(),
    showConsole: false,
    setShowConsole: vi.fn(),
    setIsSettingsOpen: vi.fn(),
    hasPendingUpdate: false,
    consoleDisabled: false,
    unreadNotificationsCount: 0,
    isNotificationsOpen: false,
    setIsNotificationsOpen: vi.fn(),
    shakeBell: false,
    ...overrides,
  };
  return render(<NavSidebar {...props} />);
}

describe('NavSidebar badges', () => {
  it('shows no badge while idle with nothing pending', () => {
    const { container } = renderSidebar();
    expect(container.querySelector('.sidebar-badge')).toBeNull();
  });

  it('marks each pending state with the shared badge on its own button', () => {
    renderSidebar({ appState: 'processing', unreadNotificationsCount: 2, hasPendingUpdate: true });

    const cases = [
      ['Dashboard', 'processing'],
      ['Apri notifiche', 'alert'],
      ['Apri impostazioni', 'accent'],
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

  it('keeps the API status dot still during a run', () => {
    renderSidebar({ appState: 'processing' });
    const status = screen.getByLabelText('API pronta');
    expect(status.querySelector('.animate-pulse')).toBeNull();
  });
});
