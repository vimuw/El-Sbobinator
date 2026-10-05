// Both the pointer-based wrap gesture and the native inline drag scroll the
// editor's actual viewport, including while the pointer is held still.
export function startImageAutoScroll(root: HTMLElement, onScroll: () => void = () => {}) {
  let container = root.parentElement;
  while (container && !(/auto|scroll/.test(getComputedStyle(container).overflowY) && container.scrollHeight > container.clientHeight)) {
    container = container.parentElement;
  }
  const scroller = container ?? document.scrollingElement;
  let x = 0;
  let y = 0;
  let active = false;
  let frame = 0;
  let previousTime: number | undefined;

  const tick = (time: number) => {
    if (!active || !scroller || !root.isConnected) return;
    const dt = Math.min(32, previousTime === undefined ? 16 : time - previousTime);
    previousTime = time;
    const rect = container?.getBoundingClientRect();
    const viewportTop = rect ? rect.top + (container?.clientTop ?? 0) : 0;
    const top = Math.max(0, viewportTop);
    const bottom = Math.min(window.innerHeight, container ? viewportTop + container.clientHeight : window.innerHeight);
    const left = Math.max(0, rect?.left ?? 0);
    const right = Math.min(window.innerWidth, rect?.right ?? window.innerWidth);
    const edge = Math.min(56, (bottom - top) / 3);
    let speed = 0;
    if (edge > 0 && x >= left && x <= right) {
      if (y < top + edge) speed = -Math.min(1, (top + edge - y) / edge);
      else if (y > bottom - edge) speed = Math.min(1, (y - bottom + edge) / edge);
    }
    if (speed) {
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, before + speed * 600 * dt / 1000));
      if (scroller.scrollTop !== before) onScroll();
    }
    frame = requestAnimationFrame(tick);
  };

  return {
    update(clientX: number, clientY: number) {
      x = clientX;
      y = clientY;
      if (!active) {
        active = true;
        frame = requestAnimationFrame(tick);
      }
    },
    stop() {
      active = false;
      cancelAnimationFrame(frame);
    },
  };
}

export function startInlineImageAutoScroll(root: HTMLElement, event: DragEvent): () => void {
  const scroll = startImageAutoScroll(root);
  const move = (e: DragEvent) => scroll.update(e.clientX, e.clientY);
  const stop = () => {
    scroll.stop();
    window.removeEventListener('dragover', move, true);
    window.removeEventListener('drop', stop, true);
    window.removeEventListener('dragend', stop, true);
    window.removeEventListener('blur', stop);
  };
  window.addEventListener('dragover', move, true);
  window.addEventListener('drop', stop, true);
  window.addEventListener('dragend', stop, true);
  window.addEventListener('blur', stop);
  scroll.update(event.clientX, event.clientY);
  return stop;
}
