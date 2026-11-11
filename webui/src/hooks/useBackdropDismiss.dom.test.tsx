import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKDROP_SHAKE_MS, useBackdropDismiss } from './useBackdropDismiss';

function Modal({ dirty, blocked, onClose }: { dirty: boolean; blocked?: boolean; onClose: () => void }) {
  const { onBackdropClick, shaking, showHint } = useBackdropDismiss({ dirty, onClose, blocked });
  return (
    <div data-testid="backdrop" onClick={onBackdropClick}>
      <div data-testid="card" data-shaking={shaking} data-hint={showHint}>
        <input aria-label="Nome" />
      </div>
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useBackdropDismiss', () => {
  it('closes on a click on the backdrop itself when nothing would be lost', () => {
    const onClose = vi.fn();
    render(<Modal dirty={false} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a click that lands inside the card', () => {
    const onClose = vi.fn();
    render(<Modal dirty={false} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Nome'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shakes once for the whole animation, then settles, without closing', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Modal dirty onClose={onClose} />);
    fireEvent.click(screen.getByTestId('backdrop'));
    expect(screen.getByTestId('card').dataset.shaking).toBe('true');

    act(() => { vi.advanceTimersByTime(BACKDROP_SHAKE_MS / 2); });
    // A second click mid-shake does not restart it.
    fireEvent.click(screen.getByTestId('backdrop'));
    act(() => { vi.advanceTimersByTime(BACKDROP_SHAKE_MS / 2); });
    expect(screen.getByTestId('card').dataset.shaking).toBe('false');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('backdrop'));
    expect(screen.getByTestId('card').dataset.shaking).toBe('true');
  });

  it('says why it shook until the edits are gone, and starts over after', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(<Modal dirty onClose={onClose} />);
    expect(screen.getByTestId('card').dataset.hint).toBe('false');
    fireEvent.click(screen.getByTestId('backdrop'));
    expect(screen.getByTestId('card').dataset.hint).toBe('true');
    // Still there once the shake is over, so it can be read.
    act(() => { vi.advanceTimersByTime(BACKDROP_SHAKE_MS); });
    expect(screen.getByTestId('card').dataset.hint).toBe('true');

    rerender(<Modal dirty={false} onClose={onClose} />);
    expect(screen.getByTestId('card').dataset.hint).toBe('false');
    rerender(<Modal dirty onClose={onClose} />);
    expect(screen.getByTestId('card').dataset.hint).toBe('false');
  });

  it('does nothing while blocked, edits or not', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Modal dirty={false} blocked onClose={onClose} />);
    fireEvent.click(screen.getByTestId('backdrop'));
    rerender(<Modal dirty blocked onClose={onClose} />);
    fireEvent.click(screen.getByTestId('backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('card').dataset.shaking).toBe('false');
  });
});
