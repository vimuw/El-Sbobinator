import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorScrollPercent, SCROLL_PERCENT_HIDE_MS } from './EditorScrollPercent';
import { scrollPillPath } from './editorScrollPillPath';

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref} data-testid="scroller" />
      <EditorScrollPercent containerRef={ref} />
    </div>
  );
}

function sizeScroller(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 815 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
}

// Where the pill's centre is placed, from the top of the scroll area (jsdom has no scroll timeline).
function centreOf(pill: HTMLElement): string {
  return /translateY\((-?[\d.]+px)\) translateY\(-50%\)/.exec(pill.style.transform)?.[1] ?? 'none';
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
      return `${pill.textContent} @ ${centreOf(pill)}`;
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
      return `${pill.textContent} @ ${centreOf(pill)}`;
    });
    expect(seen).toEqual(['50% @ 500px', '50% @ 501px', '50% @ 502px']);
  });

  it('runs down to the bottom of the scroll area, where the dock steps aside while scrolling', () => {
    render(<Harness />);
    const scroller = screen.getByTestId('scroller');
    sizeScroller(scroller, { scrollHeight: 30000, clientHeight: 1000 });
    scrollTo(scroller, 29000);
    // The thumb's centre: 1000 - 15 (arrow) - (970 / 30) / 2 (half the thumb), rounded.
    expect(centreOf(screen.getByTestId('editor-scroll-percent'))).toBe('969px');
  });

  it("rides the scroll timeline where there is one, so it moves in the thumb's own frame", () => {
    const timelines: { source: Element }[] = [];
    vi.stubGlobal('ScrollTimeline', class { constructor(options: { source: Element }) { timelines.push(options); } });
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate;
    try {
      render(<Harness />);
      const scroller = screen.getByTestId('scroller');
      sizeScroller(scroller, { scrollHeight: 3000, clientHeight: 1000 });
      scrollTo(scroller, 1000);
      const pill = screen.getByTestId('editor-scroll-percent');
      expect(pill.textContent).toBe('50%');
      expect(pill.dataset.visible).toBe('true');
      // The scroll moves it, not the event: no inline position to fall a frame behind.
      expect(pill.style.transform).toBe('');
      expect(timelines.at(-1)?.source).toBe(scroller);
      expect(animate).toHaveBeenCalledTimes(1);
      const [frames, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions & { timeline: unknown }];
      expect(options).toMatchObject({ fill: 'both', easing: 'linear' });
      expect(options.timeline).toBeInstanceOf(ScrollTimeline as unknown as new () => unknown);
      // Beside the thumb's centre from the top of its track to the bottom.
      expect(frames.map(frame => `${frame.offset} ${frame.transform}`)).toEqual([
        '0 translateY(176.66666666666666px) translateY(-50%)',
        '1 translateY(823.3333333333334px) translateY(-50%)',
      ]);

      // The same document scrolls on the same path; a longer one gets a new path.
      scrollTo(scroller, 1200);
      expect(pill.textContent).toBe('60%');
      expect(animate).toHaveBeenCalledTimes(1);
      sizeScroller(scroller, { scrollHeight: 6000, clientHeight: 1000 });
      scrollTo(scroller, 1300);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(animate).toHaveBeenCalledTimes(2);
    } finally {
      HTMLElement.prototype.animate = original;
      vi.unstubAllGlobals();
    }
  });
});

describe('scrollPillPath', () => {
  it("is the thumb's straight line between Windows' arrows", () => {
    expect(scrollPillPath({ scrollHeight: 3000, clientHeight: 1000, scrollbarWidth: 15 }))
      .toEqual([{ offset: 0, y: 176.66666666666666 }, { offset: 1, y: 823.3333333333334 }]);
  });

  it("keeps an overlay scrollbar's tiny thumb whole at both ends", () => {
    // A phone: no arrows, a 17px thumb, its centre 8.5px from each end of a 600px view. The pill
    // (20px tall) keeps 8px from both edges: off the toolbar, and level with the folded dock.
    expect(scrollPillPath({ scrollHeight: 300000, clientHeight: 600, scrollbarWidth: 0 })!.map(stop => stop.y))
      .toEqual([18, 18, 582, 582]);
  });

  it('has no path through a document that fits', () => {
    expect(scrollPillPath({ scrollHeight: 600, clientHeight: 600, scrollbarWidth: 0 })).toBeNull();
  });
});
