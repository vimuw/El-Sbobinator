import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveSession } from '../bridge';

const controls = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(),
  set: vi.fn(),
}));

// Real controls (motion subscribes to them), with the animation calls spied.
vi.mock('motion/react', async importOriginal => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useAnimationControls: () => Object.assign(actual.useAnimationControls(), controls),
  };
});

import { BrandLogo, resetBrandLogoSessionGreeting } from './BrandLogo';
import { NavSidebar } from './NavSidebar';
import { WelcomeDashboard } from './WelcomeDashboard';

const session: ArchiveSession = {
  name: 'lezione.mp3',
  completed_at_iso: new Date().toISOString(),
  html_path: '/path/to/lezione.html',
  effective_model: 'gemini-1.5-flash-latest',
  input_path: '/path/to/lezione.mp3',
  session_dir: '/sessions/abc',
  duration_sec: 3600,
};

function renderSidebar(overrides: Partial<Parameters<typeof NavSidebar>[0]> = {}) {
  const props = {
    activePage: 'archive' as const,
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
  return { props, ...render(<NavSidebar {...props} />) };
}

const flush = () => act(async () => {});

describe('BrandLogo', () => {
  beforeEach(() => {
    resetBrandLogoSessionGreeting();
    controls.start.mockClear();
    controls.stop.mockClear();
    controls.set.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sidebar logo navigates to the Dashboard instead of greeting', () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Vai alla Dashboard' }));
    expect(props.setActivePage).toHaveBeenCalledWith('queue');
    expect(controls.start).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Saluta El Sbobinator' })).toBeNull();
  });

  it('greets once per app session when the dashboard says Bentornato', async () => {
    const first = render(<WelcomeDashboard archiveSessions={[session]} />);
    expect(screen.getByText('Bentornato')).toBeTruthy();
    expect(controls.start).toHaveBeenCalledTimes(1);
    first.rerender(<WelcomeDashboard archiveSessions={[session, { ...session, session_dir: '/sessions/def' }]} />);
    await flush();
    first.unmount();

    render(<WelcomeDashboard archiveSessions={[session]} />);
    await flush();
    expect(controls.start).toHaveBeenCalledTimes(1);
  });

  it('replays the greeting if it was interrupted before finishing', async () => {
    controls.start.mockImplementationOnce(() => new Promise(() => {}));
    const first = render(<WelcomeDashboard archiveSessions={[session]} />);
    first.unmount();
    render(<WelcomeDashboard archiveSessions={[session]} />);
    await flush();
    expect(controls.start).toHaveBeenCalledTimes(2);
  });

  it('does not greet first-time users on the Benvenuto heading', () => {
    render(<WelcomeDashboard archiveSessions={[]} />);
    expect(controls.start).not.toHaveBeenCalled();
  });

  it('dashboard heading logo keeps the click greet easter egg', () => {
    render(<WelcomeDashboard archiveSessions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saluta El Sbobinator' }));
    expect(controls.start).toHaveBeenCalledTimes(1);
  });

  it('celebrates once when a transcription completes', () => {
    const { props, rerender } = renderSidebar();
    expect(controls.start).not.toHaveBeenCalled();
    rerender(<NavSidebar {...props} completionFlash />);
    expect(controls.start).toHaveBeenCalledTimes(1);
    const celebration = (controls.start.mock.calls[0] as unknown as [{ y: number[] }])[0];
    expect(Math.min(...celebration.y)).toBeLessThan(-36 * 0.3);
    rerender(<NavSidebar {...props} completionFlash />);
    rerender(<NavSidebar {...props} completionFlash={false} />);
    expect(controls.start).toHaveBeenCalledTimes(1);
    rerender(<NavSidebar {...props} completionFlash />);
    expect(controls.start).toHaveBeenCalledTimes(2);
  });

  it('ignores Windows reduced motion like the rest of the app', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<BrandLogo size={52} welcome />);
    expect(controls.start).toHaveBeenCalledTimes(1);
  });
});
