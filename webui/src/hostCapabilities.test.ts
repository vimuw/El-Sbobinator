import { afterEach, describe, expect, it } from 'vitest';
import { DESKTOP_CAPABILITIES, getHostCapabilities, setHostCapabilities } from './hostCapabilities';

describe('host capabilities', () => {
  afterEach(() => setHostCapabilities(DESKTOP_CAPABILITIES));

  it('defaults to the desktop app, which can do everything', () => {
    expect(getHostCapabilities()).toEqual(DESKTOP_CAPABILITIES);
    expect(Object.entries(DESKTOP_CAPABILITIES).filter(([, value]) => value === false)).toEqual([]);
  });

  it('lets a host turn features off while keeping the rest', () => {
    setHostCapabilities({ kind: 'browser', openLocalPath: false });
    expect(getHostCapabilities()).toEqual({ ...DESKTOP_CAPABILITIES, kind: 'browser', openLocalPath: false });
  });
});
