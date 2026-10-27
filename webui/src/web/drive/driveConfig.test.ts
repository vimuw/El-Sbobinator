import { describe, expect, it } from 'vitest';
import { GOOGLE_CLIENT_ID, createDriveConnection, driveEnabled } from './driveConfig';

const CLIENT = '123456789-abc.apps.googleusercontent.com';

describe('Drive sync configuration', () => {
  it('is off in builds without a client ID (the unit tests are one)', () => {
    expect(GOOGLE_CLIENT_ID).toBe('');
    expect(driveEnabled()).toBe(false);
    expect(createDriveConnection()).toBeNull();
  });

  it('is on in every build with a client ID, the released site included', () => {
    expect(driveEnabled(CLIENT)).toBe(true);
    expect(driveEnabled('')).toBe(false);
    for (const origin of ['https://elsbobinator.com', 'https://anteprima.elsbobinator.pages.dev']) {
      const connection = createDriveConnection(CLIENT, origin);
      expect(connection?.auth.token()).toBeNull();
      expect(connection?.api.listChanged).toBeTypeOf('function');
    }
  });
});
