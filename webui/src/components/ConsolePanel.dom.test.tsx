import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  // Collapsing used to swap the logs for the tail at once, so the panel dropped in one frame and
  // the text jumped. The scrolling logs now ease down to the tail's height, held at their last
  // line, and only then give way to the tail, which shows the same lines in the same place.
  it('eases the logs back to the tail before swapping, held at their last line', async () => {
    const logs = Array.from({ length: 12 }, (_, i) => `[12:00:${String(i).padStart(2, '0')}] riga ${i}`);
    const { container, rerender } = render(<ConsolePanel consoleLogs={logs} lastConsoleMessage="" appState="idle" isConsoleExpanded />);
    const scroll = container.querySelector('.console-scroll') as HTMLElement;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 400 });

    rerender(<ConsolePanel consoleLogs={logs} lastConsoleMessage="" appState="idle" isConsoleExpanded={false} />);
    expect(container.querySelector('.console-scroll')).toBe(scroll);
    expect(container.querySelector('.console-tail')).toBeNull();
    expect(scroll.style.height).not.toBe('');
    expect(scroll.scrollTop).toBe(400);

    await waitFor(() => expect(container.querySelector('.console-tail')).not.toBeNull());
    expect(container.querySelector('.console-scroll')).toBeNull();
    const tail = container.querySelector('.console-tail') as HTMLElement;
    expect(Array.from(tail.children, line => line.textContent)).toEqual(logs.slice(-3));
    // Both reserve the same scrollbar room, so lines wrap alike in either view.
    expect(tail.classList.contains('console-lines')).toBe(true);
    expect(scroll.classList.contains('console-lines')).toBe(true);
  });

  // Opened already expanded (the choice outlives the console), the panel never showed its tail,
  // so with no log lines the logs eased all the way to 0 px and the last message popped in after.
  // They ease to one line of it instead.
  it('collapses a console opened expanded with no lines to one line, not to nothing', async () => {
    const { container, rerender } = render(<ConsolePanel consoleLogs={[]} lastConsoleMessage="msg" appState="idle" isConsoleExpanded />);
    const scroll = container.querySelector('.console-scroll') as HTMLElement;
    // jsdom has no layout: the logs are 208 px tall at rest, 12 px padding and 16 px lines.
    vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => ({ height: scroll.style.height ? parseFloat(scroll.style.height) : 208 }) as DOMRect);
    const computed = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => (
      el === scroll ? { paddingTop: '12px', paddingBottom: '12px', lineHeight: '16px', fontSize: '12px' } as CSSStyleDeclaration : computed(el, pseudo)
    ));
    const heights: number[] = [];
    const watch = new MutationObserver(() => { if (scroll.style.height) heights.push(parseFloat(scroll.style.height)); });
    watch.observe(scroll, { attributes: true, attributeFilter: ['style'] });
    try {
      rerender(<ConsolePanel consoleLogs={[]} lastConsoleMessage="msg" appState="idle" isConsoleExpanded={false} />);
      expect(await screen.findByText('msg')).toBeTruthy();
      expect(heights.length).toBeGreaterThan(1);
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(39);
    } finally {
      watch.disconnect();
      vi.restoreAllMocks();
    }
  });

  it('starts expanding from the tail, with the logs already in place', () => {
    const logs = ['[12:00:00] uno', '[12:00:01] due'];
    const { container, rerender } = render(<ConsolePanel consoleLogs={logs} lastConsoleMessage="" appState="idle" />);
    rerender(<ConsolePanel consoleLogs={logs} lastConsoleMessage="" appState="idle" isConsoleExpanded />);
    const scroll = container.querySelector('.console-scroll') as HTMLElement;
    expect(Array.from(scroll.children, line => line.textContent)).toEqual(logs);
    expect(scroll.style.height).not.toBe('');
    expect(container.querySelector('.console-tail')).toBeNull();
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

  it('collapses back when chevron is clicked again', async () => {
    render(<ConsolePanel consoleLogs={[]} lastConsoleMessage="msg" appState="idle" />);
    fireEvent.click(screen.getByTitle('Espandi'));
    fireEvent.click(screen.getByTitle('Riduci'));
    // The tail comes back once the logs have eased down to it.
    expect(await screen.findByText('msg')).toBeTruthy();
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
