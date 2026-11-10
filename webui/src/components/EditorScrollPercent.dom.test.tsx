import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorScrollPercent, SCROLL_PERCENT_HIDE_MS } from './EditorScrollPercent';

function Harness({ bottomInset }: { bottomInset?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref} data-testid="scroller" />
      <EditorScrollPercent containerRef={ref} bottomInset={bottomInset} />
    </div>
  );
}

function sizeScroller(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 815 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
}

function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top;
    el.dispatchEvent(new Event('scroll'));
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EditorScrollPercent', () => {
  it('reads the share of the scrollable range, clamped to 0–100', () => {
    render(<Harness />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 3000, clientHeight: 1000 });
    const seen = [250, 0, 2400].map(top => {
      scrollTo(scroller, top);
      return screen.getByTestId('editor-scroll-percent').textContent;
    });
    expect(seen).toEqual(['13%', '0%', '100%']);
  });

  it('has nothing to say for a document that fits', () => {
    render(<Harness />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 800, clientHeight: 1000 });
    scrollTo(scroller, 10);
    expect(screen.queryByTestId('editor-scroll-percent')).toBeNull();
  });

  it('shows the percentage beside the scrollbar while scrolling, then fades it', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 3000, clientHeight: 1000 });
    expect(screen.queryByTestId('editor-scroll-percent')).toBeNull();

    scrollTo(scroller, 1000);
    const pill = screen.getByTestId('editor-scroll-percent');
    expect(pill.textContent).toBe('50%');
    expect(pill.dataset.visible).toBe('true');
    // Clear of the 15px scrollbar.
    expect(pill.style.right).toBe('21px');

    act(() => { vi.advanceTimersByTime(SCROLL_PERCENT_HIDE_MS); });
    expect(pill.dataset.visible).toBe('false');
  });

  it('ignores sideways scrolling', () => {
    render(<Harness />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 3000, clientHeight: 1000 });
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(screen.queryByTestId('editor-scroll-percent')).toBeNull();
  });

  it('sits beside the thumb, between the arrow buttons of the 15px Windows scrollbar', () => {
    render(<Harness />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 3000, clientHeight: 1000 });
    const seen = [1000, 0, 2000].map(top => {
      scrollTo(scroller, top);
      const pill = screen.getByTestId('editor-scroll-percent');
      return `${pill.textContent} @ ${pill.style.top}`;
    });
    // Track 1000 - 2 * 15 = 970, thumb 970 / 3: its centre runs from 15 + 162 to 985 - 162.
    expect(seen).toEqual(['50% @ 500px', '0% @ 177px', '100% @ 823px']);
  });

  it('moves with the thumb, not in one-percent steps', () => {
    render(<Harness />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 3000, clientHeight: 1000 });
    const seen = [1000, 1003, 1006].map(top => {
      scrollTo(scroller, top);
      const pill = screen.getByTestId('editor-scroll-percent');
      return `${pill.textContent} @ ${pill.style.top}`;
    });
    expect(seen).toEqual(['50% @ 500px', '50% @ 501px', '50% @ 502px']);
  });

  it('stops above the player floating over the bottom', () => {
    render(<Harness bottomInset={120} />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 30000, clientHeight: 1000 });
    scrollTo(scroller, 29000);
    const pill = screen.getByTestId('editor-scroll-percent');
    expect(pill.textContent).toBe('100%');
    expect(pill.style.top).toBe(`${1000 - 120 - 10}px`);
  });
});
