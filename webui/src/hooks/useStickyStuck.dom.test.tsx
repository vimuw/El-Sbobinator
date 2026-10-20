import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useStickyStuck } from './useStickyStuck';

function Toolbar() {
  const [ref, stuck] = useStickyStuck();
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      <div ref={ref} data-testid="toolbar" data-stuck={stuck} style={{ position: 'sticky', top: '8px' }} />
    </div>
  );
}

function rect(top: number): DOMRect {
  return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
}

describe('useStickyStuck', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('flags the toolbar only while it is pinned with content scrolled behind it', () => {
    render(<Toolbar />);
    const scroller = screen.getByTestId('scroller');
    const toolbar = screen.getByTestId('toolbar');
    scroller.getBoundingClientRect = () => rect(100);
    let scrollTop = 0; // jsdom has no layout, so scrollTop is otherwise always 0
    Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, configurable: true });

    // At rest: the toolbar sits lower in the page, nothing scrolled.
    toolbar.getBoundingClientRect = () => rect(400);
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(toolbar.dataset.stuck).toBe('false');

    // Scrolled until the toolbar reaches its 8px sticky offset.
    scrollTop = 300;
    toolbar.getBoundingClientRect = () => rect(108);
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(toolbar.dataset.stuck).toBe('true');

    // Scrolled back to the top: the panel framing goes away again.
    scrollTop = 0;
    toolbar.getBoundingClientRect = () => rect(400);
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(toolbar.dataset.stuck).toBe('false');
  });
});
