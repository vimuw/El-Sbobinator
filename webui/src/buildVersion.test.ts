import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('web preview build', () => {
  it('labels a build without a version tag as a preview of the package version', async () => {
    vi.stubEnv('EL_SBOBINATOR_WEB_VERSION', '');
    const config = (await import('../vite.config')).default;
    expect(config.define?.__APP_VERSION__).toBe(JSON.stringify(`v${packageVersion}`));
    expect(config.define?.__WEB_PREVIEW__).toBe('true');
  });
});

describe('web release build', () => {
  const clientId = '123456789-abc123def.apps.googleusercontent.com';

  it('takes the Drive client ID with a version tag, so the released site can sync', async () => {
    vi.stubEnv('EL_SBOBINATOR_WEB_VERSION', 'web-v1.3.0');
    vi.stubEnv('EL_SBOBINATOR_GOOGLE_CLIENT_ID', clientId);
    const { createViteConfig } = await import('../vite.config');
    const config = createViteConfig();
    expect(config.define?.__APP_VERSION__).toBe(JSON.stringify('v1.3.0'));
    expect(config.define?.__WEB_PREVIEW__).toBe('false');
    expect(config.define?.__GOOGLE_CLIENT_ID__).toBe(JSON.stringify(clientId));
    expect(Object.keys(config.build?.rolldownOptions?.input ?? {})).toContain('drive-auth');
  });

  it('is built without Drive when the release has no client ID', async () => {
    vi.stubEnv('EL_SBOBINATOR_WEB_VERSION', 'web-v1.3.0');
    vi.stubEnv('EL_SBOBINATOR_GOOGLE_CLIENT_ID', '');
    const { createViteConfig } = await import('../vite.config');
    const config = createViteConfig();
    expect(config.define?.__GOOGLE_CLIENT_ID__).toBe('""');
    expect(Object.keys(config.build?.rolldownOptions?.input ?? {})).not.toContain('drive-auth');
  });
});
