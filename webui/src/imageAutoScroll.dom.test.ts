import { afterEach, describe, expect, it, vi } from 'vitest';
import { startImageAutoScroll, startInlineImageAutoScroll } from './imageAutoScroll';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup() {
  const container = document.createElement('div');
  container.style.overflowY = 'auto';
  const root = document.createElement('div');
  container.appendChild(root);
  document.body.appendChild(container);
  Object.defineProperties(container, { clientHeight: { value: 400 }, scrollHeight: { value: 2000 } });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 500, left: 50, right: 750 } as DOMRect);
  let callback: FrameRequestCallback;
  let time = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { callback = fn; return 1; });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  return { container, root, cancel, frame: () => callback(time += 16) };
}

describe('image drag automatic scrolling', () => {
  it('keeps scrolling with a stationary pointer, reverses at the upper edge and respects bounds', () => {
    const { root, container, frame, cancel } = setup();
    const preview = vi.fn();
    const scroll = startImageAutoScroll(root, preview);
    scroll.update(200, 510);
    frame(); frame();
    expect(container.scrollTop).toBeCloseTo(19.2);
    expect(preview).toHaveBeenCalledTimes(2);
    scroll.update(200, 90);
    frame(); frame(); frame();
    expect(container.scrollTop).toBe(0);
    container.scrollTop = 1599;
    scroll.update(200, 510);
    frame();
    expect(container.scrollTop).toBe(1600);
    scroll.stop();
    expect(cancel).toHaveBeenCalled();
    frame();
    expect(container.scrollTop).toBe(1600);
  });

  it('does not scroll in the center or beyond the horizontal viewport and slows near the edge', () => {
    const { root, container, frame } = setup();
    const scroll = startImageAutoScroll(root);
    scroll.update(200, 300);
    frame();
    expect(container.scrollTop).toBe(0);
    scroll.update(800, 510);
    frame();
    expect(container.scrollTop).toBe(0);
    scroll.update(200, 472);
    frame();
    expect(container.scrollTop).toBeCloseTo(4.8);
    scroll.stop();
  });

  it.each(['drop', 'dragend', 'blur'])('stops native inline scrolling on %s and removes dragover listeners', eventName => {
    const { root, container, frame, cancel } = setup();
    const stop = startInlineImageAutoScroll(root, { clientX: 200, clientY: 300 } as DragEvent);
    const move = new Event('dragover');
    Object.assign(move, { clientX: 200, clientY: 510 });
    window.dispatchEvent(move);
    frame();
    expect(container.scrollTop).toBeCloseTo(9.6);
    window.dispatchEvent(new Event(eventName));
    expect(cancel).toHaveBeenCalled();
    const before = container.scrollTop;
    window.dispatchEvent(move);
    frame();
    expect(container.scrollTop).toBe(before);
    stop();
  });

  it('stops updating when the editor is removed during the gesture', () => {
    const { root, container, frame } = setup();
    const scroll = startImageAutoScroll(root);
    scroll.update(200, 510);
    root.remove();
    frame();
    expect(container.scrollTop).toBe(0);
    scroll.stop();
  });
});
