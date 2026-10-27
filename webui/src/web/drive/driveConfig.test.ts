import { describe, expect, it } from 'vitest';
import { GOOGLE_CLIENT_ID, createDriveConnection, driveEnabled } from './driveConfig';

const CLIENT = '123456789-abc.apps.googleusercontent.com';

describe('Drive sync configuration', () => {
  it('is off in builds without a client ID (the unit tests are one)', () => {
    expect(GOOGLE_CLIENT_ID).toBe('');
    expect(driveEnabled()).toBe(false);
    expect(createDriveConnection()).toBeNull();
  });

  it('is on only in previews with a client ID', () => {
    expect(driveEnabled(CLIENT, true)).toBe(true);
    expect(driveEnabled(CLIENT, false)).toBe(false);
    expect(driveEnabled('', true)).toBe(false);
    expect(createDriveConnection(CLIENT, false, 'https://elsbobinator.com')).toBeNull();
    const connection = createDriveConnection(CLIENT, true, 'https://anteprima.elsbobinator.pages.dev');
    expect(connection?.auth.token()).toBeNull();
    expect(connection?.api.listChanged).toBeTypeOf('function');
  });
});
