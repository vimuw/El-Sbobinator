import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AutoHeight } from './AutoHeight';

describe('AutoHeight', () => {
  let report = () => {};
  let contentHeight = 68;

  beforeEach(() => {
    contentHeight = 68;
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() { report = () => this.callback([], this as unknown as ResizeObserver); }
      unobserve() {}
      disconnect() {}
    });
    // The slot shows its last height until it is told otherwise; the content reports its own.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'slot' ? 68 : contentHeight;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // The browser runs ResizeObserver callbacks after layout and before painting that frame. Taller
  // content swapped in (the console after "Mostra console") must already be clipped then: a frame
  // with it shown whole over the page, then cut to the old height and grown again, read as the
  // panel rising and dropping back.
  it('clips taller content and holds the old height before the browser paints, not a frame later', async () => {
    const onSettled = vi.fn();
    render(<AutoHeight testId="slot" onSettled={onSettled}><div>contenuto</div></AutoHeight>);
    const slot = screen.getByTestId('slot');
    expect(slot.style.overflow).toBe('');

    contentHeight = 148;
    // Called as the browser would, outside React's act: the clip must be on by the time the
    // callback returns.
    report();
    expect(slot.style.overflow).toBe('hidden');
    expect(slot.style.height).toBe('68px');

    // Settled, it is back to `auto` and lets tooltips and focus rings out again.
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(slot.style.height).toBe('');
    expect(slot.style.overflow).toBe('');
  });

  it('with followInnerResizes, eases a swap of its children but follows content that resizes itself', async () => {
    const Slot = ({ swapped }: { swapped: boolean }) => (
      <AutoHeight testId="slot" followInnerResizes>
        {swapped ? <div key="b">pannello</div> : <div key="a">pulsante</div>}
      </AutoHeight>
    );
    const { rerender } = render(<Slot swapped={false} />);
    const slot = screen.getByTestId('slot');

    // The console expanding its own logs: followed, never clipped or held back.
    contentHeight = 120;
    report();
    expect(slot.style.overflow).toBe('');
    expect(slot.style.height).toBe('');

    // The toggle swapped for the console: eased from the height the slot had followed to.
    rerender(<Slot swapped />);
    await act(async () => {});
    contentHeight = 260;
    report();
    expect(slot.style.overflow).toBe('hidden');
    expect(slot.style.height).toBe('120px');
  });
});
