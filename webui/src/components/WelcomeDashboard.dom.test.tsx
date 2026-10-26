import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchiveSession } from '../bridge';
import { WelcomeDashboard } from './WelcomeDashboard';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';

function makeSession(overrides: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    name: 'lezione.mp3',
    completed_at_iso: new Date().toISOString(),
    html_path: '/path/to/lezione.html',
    effective_model: 'gemini-1.5-flash-latest',
    input_path: '/path/to/lezione.mp3',
    session_dir: '/sessions/abc',
    duration_sec: 3600,
    ...overrides,
  };
}

describe('WelcomeDashboard', () => {
  it('shows first-time welcome message when there are no sessions', () => {
    render(<WelcomeDashboard archiveSessions={[]} />);
    expect(screen.getByText(/Benvenuto in El Sbobinator/)).toBeTruthy();
    expect(screen.getByText(/prima sbobinatura/)).toBeTruthy();
  });

  it('keeps the how-to-start line and no summary when there are no sessions', () => {
    render(<WelcomeDashboard archiveSessions={[]} />);
    expect(screen.queryByTestId('welcome-summary')).toBeNull();
    expect(screen.getByText(/Trascina un file audio o video/)).toBeTruthy();
  });

  it('says to pick a file, not drag it, on a touch screen with the web build', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
    setHostCapabilities({ kind: 'web' });
    try {
      render(<WelcomeDashboard archiveSessions={[]} />);
      expect(screen.getByText('Scegli un file audio o video per iniziare la prima sbobinatura.')).toBeTruthy();
      expect(screen.queryByText(/Trascina/)).toBeNull();
    } finally {
      setHostCapabilities(DESKTOP_CAPABILITIES);
      vi.unstubAllGlobals();
    }
  });

  it('shows returning welcome message when sessions exist', () => {
    render(<WelcomeDashboard archiveSessions={[makeSession()]} />);
    expect(screen.getByText(/Bentornato/)).toBeTruthy();
  });

  it('replaces the how-to-start line with the archive summary when sessions exist', () => {
    render(<WelcomeDashboard archiveSessions={[makeSession()]} />);
    expect(screen.getByTestId('welcome-summary')).toBeTruthy();
    expect(screen.queryByText(/Trascina un nuovo file/)).toBeNull();
  });

  it('celebrates the first lecture with its length', () => {
    render(<WelcomeDashboard archiveSessions={[makeSession({ duration_sec: 2700 })]} />);
    expect(screen.getByTestId('welcome-summary').textContent).toBe('Hai sbobinato la tua prima lezione: 45 minuti di audio.');
  });

  it('counts lectures and sums their audio across sessions', () => {
    const sessions = [
      makeSession({ session_dir: '/s/1', duration_sec: 3600 }),
      makeSession({ session_dir: '/s/2', duration_sec: 1800 }),
    ];
    render(<WelcomeDashboard archiveSessions={sessions} />);
    expect(screen.getByTestId('welcome-summary').textContent).toBe(
      'Finora hai sbobinato 2 lezioni, per un totale di 1 ora e 30 minuti di audio.',
    );
  });

  it('highlights only the figures, the same way for one lecture or many', () => {
    const { rerender } = render(<WelcomeDashboard archiveSessions={[makeSession({ duration_sec: 2700 })]} />);
    const figures = () => [...screen.getByTestId('welcome-summary').querySelectorAll('strong')].map(el => el.textContent);
    expect(figures()).toEqual(['prima lezione', '45 minuti']);
    rerender(<WelcomeDashboard archiveSessions={[makeSession({ session_dir: '/s/1', duration_sec: 7200 }), makeSession({ session_dir: '/s/2', duration_sec: 0 })]} />);
    expect(figures()).toEqual(['2 lezioni', '2 ore']);
  });

  it.each([
    [60, '1 minuto'],
    [7200, '2 ore'],
    [5580, '1 ora e 33 minuti'],
    [10 * 3600 + 25 * 60, '10 ore'],
  ])('says %i seconds of audio as "%s"', (durationSec, spoken) => {
    const sessions = [makeSession({ session_dir: '/s/1', duration_sec: durationSec }), makeSession({ session_dir: '/s/2', duration_sec: 0 })];
    render(<WelcomeDashboard archiveSessions={sessions} />);
    expect(screen.getByTestId('welcome-summary').textContent).toContain(`per un totale di ${spoken} di audio.`);
  });

  it('leaves the duration out instead of showing less than a minute', () => {
    render(<WelcomeDashboard archiveSessions={[makeSession({ duration_sec: undefined })]} />);
    expect(screen.getByTestId('welcome-summary').textContent).toBe('Hai sbobinato la tua prima lezione.');
    const sessions = [makeSession({ session_dir: '/s/1', duration_sec: 20 }), makeSession({ session_dir: '/s/2', duration_sec: 10 })];
    render(<WelcomeDashboard archiveSessions={sessions} />);
    expect(screen.getAllByTestId('welcome-summary')[1].textContent).toBe('Finora hai sbobinato 2 lezioni.');
  });
});
