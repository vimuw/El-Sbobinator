import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES, getHostCapabilities, setHostCapabilities } from './hostCapabilities';

describe('host capabilities', () => {
  afterEach(() => setHostCapabilities(DEFAULT_CAPABILITIES));

  it('defaults to permanent deletion and the email report', () => {
    expect(getHostCapabilities()).toEqual({ permanentDelete: true, reportByEmail: true });
  });

  it('lets the web build turn features off while keeping the rest', () => {
    setHostCapabilities({ permanentDelete: false });
    expect(getHostCapabilities()).toEqual({ permanentDelete: false, reportByEmail: true });
  });
});
