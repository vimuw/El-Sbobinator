import { describe, expect, it, vi } from 'vitest';
import { scheduleEditorPreload } from './editorPreload';

function fakeWindow(withIdle: boolean) {
  const idle: Array<() => void> = [];
  const win = {
    setTimeout: vi.fn((callback: () => void) => { idle.push(callback); return 7; }),
    clearTimeout: vi.fn(),
    ...(withIdle ? {
      requestIdleCallback: vi.fn((callback: () => void) => { idle.push(callback); return 3; }),
      cancelIdleCallback: vi.fn(),
    } : {}),
  };
  return { win: win as unknown as Parameters<typeof scheduleEditorPreload>[0], idle, raw: win };
}

describe('scheduleEditorPreload', () => {
  it('warms the editor chunks when the browser is idle', () => {
    const { win, idle, raw } = fakeWindow(true);
    const preload = vi.fn().mockResolvedValue(undefined);

    scheduleEditorPreload(win, preload);
    expect(preload).not.toHaveBeenCalled();
    idle.forEach(run => run());

    expect(preload).toHaveBeenCalledTimes(1);
    expect(raw.setTimeout).not.toHaveBeenCalled();
  });

  it('falls back to a timer where requestIdleCallback is missing', () => {
    const { win, idle, raw } = fakeWindow(false);
    const preload = vi.fn().mockResolvedValue(undefined);

    scheduleEditorPreload(win, preload);
    idle.forEach(run => run());

    expect(raw.setTimeout).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending warm-up and tolerates a failed one', async () => {
    const { win, raw } = fakeWindow(true);
    scheduleEditorPreload(win, vi.fn())();
    expect(raw.cancelIdleCallback).toHaveBeenCalledWith(3);

    const failing = fakeWindow(false);
    const preload = vi.fn().mockRejectedValue(new Error('chunk'));
    scheduleEditorPreload(failing.win, preload);
    expect(() => failing.idle.forEach(run => run())).not.toThrow();
    await Promise.resolve();
    expect(preload).toHaveBeenCalledTimes(1);
  });
});
