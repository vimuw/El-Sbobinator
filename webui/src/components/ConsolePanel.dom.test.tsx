import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsolePanel } from './ConsolePanel';

describe('ConsolePanel', () => {
  it('preserves traceback indentation and copies complete lines', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const logs = [
      '[12:00:00]     notify_data = NOTIFYICONDATAW(*largs)',
      '[12:00:00]                   ^^^^^^^^^^^^^^^^^^^^^^',
      '[12:00:00] ValueError: string too long (65, maximum length 64)',
    ];
    const { container } = render(<ConsolePanel consoleLogs={logs} lastConsoleMessage="" appState="idle" isConsoleExpanded />);
    const scrollArea = container.querySelector('.console-scroll') as HTMLElement;
    expect(scrollArea.style.whiteSpace).toBe('pre-wrap');
    expect(Array.from(scrollArea.children, entry => entry.textContent)).toEqual(logs);
    fireEvent.click(screen.getByTitle('Copia tutto'));
    expect(writeText).toHaveBeenCalledWith(logs.join('\n'));
  });

  it('shows last console message when collapsed', () => {
    render(<ConsolePanel consoleLogs={[]} lastConsoleMessage="Ultimo messaggio" appState="idle" />);
    expect(screen.getByText('Ultimo messaggio')).toBeTruthy();
  });

  it('shows the last three log lines when collapsed, like a terminal tail', () => {
    const logs = ['[12:00:00] uno', '[12:00:01] due', '[12:00:02] tre', '[12:00:03] quattro'];
    const { container } = render(<ConsolePanel consoleLogs={logs} lastConsoleMessage="[12:00:03] quattro" appState="processing" />);
    const tail = container.querySelector('.console-tail') as HTMLElement;
    expect(Array.from(tail.children, line => line.textContent)).toEqual(logs.slice(1));
    expect(container.querySelector('.console-scroll')).toBeNull();
  });

  it('shows Console heading', () => {
    render(<ConsolePanel consoleLogs={[]} lastConsoleMessage="" appState="idle" />);
    expect(screen.getByText('Console')).toBeTruthy();
  });

  it('expands when expand button is clicked and shows log entries', () => {
    render(<ConsolePanel consoleLogs={['[12:00:00] log uno', 'log due']} lastConsoleMessage="" appState="idle" />);
    fireEvent.click(screen.getByTitle('Espandi'));
    expect(screen.getByText(/log uno/)).toBeTruthy();
    expect(screen.getByText(/log due/)).toBeTruthy();
  });

  it('shows copy button when expanded', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    render(<ConsolePanel consoleLogs={['a']} lastConsoleMessage="" appState="idle" />);
    fireEvent.click(screen.getByTitle('Espandi'));
    expect(screen.getByTitle('Copia tutto')).toBeTruthy();
  });

  it('collapses back when chevron is clicked again', () => {
    render(<ConsolePanel consoleLogs={[]} lastConsoleMessage="msg" appState="idle" />);
    fireEvent.click(screen.getByTitle('Espandi'));
    fireEvent.click(screen.getByTitle('Riduci'));
    expect(screen.getByText('msg')).toBeTruthy();
  });

  it('uses processing pulse when appState is processing', () => {
    const { container } = render(<ConsolePanel consoleLogs={[]} lastConsoleMessage="" appState="processing" />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('colors each line by its leading severity marker, not by the words it contains', () => {
    const logs = [
      '[12:00:00] ❌ Errore imprevisto: elaborazione interrotta.',
      '[12:00:01] ⚠ Sbobina completata con avvisi in 3m 05s: 1 sezione inclusa senza revisione (sezione 2).',
      '[12:00:02] ✅ Sbobina completata in 3m 05s.',
      '[12:00:03] Annullamento in corso, attendere prego...',
      '[12:00:04] Dettaglio: Errore 500 dal server',
      '[12:00:05] ValueError: string too long (65, maximum length 64)',
      '[11:00:06 PM] ⚠ Connessione a Internet interrotta.',
    ];
    const { container } = render(<ConsolePanel consoleLogs={logs} lastConsoleMessage="" appState="idle" isConsoleExpanded />);
    const lines = Array.from(container.querySelectorAll('.console-scroll > div'));
    expect(lines.map(line => line.getAttribute('data-tone'))).toEqual([
      'error', 'warning', 'success', 'normal', 'normal', 'error', 'warning',
    ]);
    // The timestamp stays muted whatever its locale format.
    expect(lines[6].firstElementChild?.textContent).toBe('[11:00:06 PM]');
  });

  it('clicking copy button writes to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<ConsolePanel consoleLogs={['line1', 'line2']} lastConsoleMessage="" appState="idle" />);
    fireEvent.click(screen.getByTitle('Espandi'));
    fireEvent.click(screen.getByTitle('Copia tutto'));
    expect(writeText).toHaveBeenCalledWith('line1\nline2');
  });

  it('mouseEnter and mouseLeave on scroll area do not throw', () => {
    const { container } = render(<ConsolePanel consoleLogs={['msg']} lastConsoleMessage="" appState="idle" />);
    fireEvent.click(screen.getByTitle('Espandi'));
    const scrollArea = container.querySelector('.console-scroll') as HTMLElement;
    fireEvent.mouseEnter(scrollArea);
    fireEvent.mouseLeave(scrollArea);
  });
});
