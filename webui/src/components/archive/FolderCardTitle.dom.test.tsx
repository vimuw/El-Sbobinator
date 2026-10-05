import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderCardTitle } from './FolderCardTitle';

describe('FolderCardTitle', () => {
  let contentHeight: number;
  let resize: () => void;

  beforeEach(() => {
    contentHeight = 40;
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('only offers a tooltip and keyboard focus when the rendered title overflows', () => {
    render(<FolderCardTitle name="FISIOPATOLOGIA 1" onNavigate={vi.fn()} />);
    const title = screen.getByText('FISIOPATOLOGIA 1');
    fireEvent.mouseEnter(title);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(title.hasAttribute('tabindex')).toBe(false);

    contentHeight = 60;
    act(() => resize());
    fireEvent.mouseEnter(title);
    expect(screen.getByRole('tooltip').textContent).toBe('FISIOPATOLOGIA 1');
    expect(title.tabIndex).toBe(0);

    contentHeight = 40;
    act(() => resize());
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(title.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps the full name readable while moving the pointer into the tooltip', () => {
    contentHeight = 80;
    render(<FolderCardTitle name="Patologia generale e fisiopatologia" onNavigate={vi.fn()} />);
    const title = screen.getByText('Patologia generale e fisiopatologia');
    fireEvent.mouseEnter(title);
    fireEvent.mouseLeave(title);
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole('tooltip')).toBeTruthy();

    fireEvent.mouseLeave(screen.getByRole('tooltip'));
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the full name on focus, supports Enter, and dismisses with Escape', () => {
    contentHeight = 80;
    const onNavigate = vi.fn();
    render(<FolderCardTitle name="Patologia generale e fisiopatologia" onNavigate={onNavigate} />);
    const title = screen.getByText('Patologia generale e fisiopatologia');
    act(() => title.focus());
    expect(title.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.mouseLeave(title);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(title);
  });

  it('dismisses a tooltip when the viewport scrolls or a drag starts', () => {
    contentHeight = 80;
    render(<FolderCardTitle name="Nome lungo" onNavigate={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByText('Nome lungo'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(screen.getByText('Nome lungo'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.pointerDown(screen.getByText('Nome lungo', { selector: '.folder-card-title' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
