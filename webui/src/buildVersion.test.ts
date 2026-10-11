import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('desktop build version', () => {
  it.each([
    [undefined, packageVersion],
    ['2.7.3', '2.7.3'],
    ['v2.7.3', '2.7.3'],
  ])('uses %s consistently for the bundle and desktop manifest', async (override, expected) => {
    vi.stubEnv('EL_SBOBINATOR_BUILD_VERSION', override);
    const config = (await import('../vite.config')).default;
    expect(config.define?.__APP_VERSION__).toBe(JSON.stringify(`v${expected}`));
    const plugin = config.plugins?.find(plugin =>
      plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === 'desktop-build-version');
    if (!plugin || typeof plugin !== 'object' || !('generateBundle' in plugin)
      || typeof plugin.generateBundle !== 'function') throw new Error('Desktop manifest plugin missing');
    const emitFile = vi.fn();
    Reflect.apply(plugin.generateBundle, { emitFile }, [{}, {}, false]);
    expect(emitFile).toHaveBeenCalledOnce();
    const asset = emitFile.mock.calls[0][0];
    expect(asset.type).toBe('asset');
    expect(asset.fileName).toBe('desktop-build.json');
    const manifest = JSON.parse(asset.source);
    expect(manifest.version).toBe(expected);
    expect(manifest.dependencies).toEqual({
      python_lock_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      npm_lock_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
