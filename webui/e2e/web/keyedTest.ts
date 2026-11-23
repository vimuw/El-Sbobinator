import { test as base } from '@playwright/test';

// A dummy key in the right format: these tests never call Gemini (they open the app with
// ?simulazione=rapida or ?simulazione=1, the M0 simulated run with or without its pauses).
// Every page of the test starts past the key setup.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';

export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.addInitScript(key => {
      try {
        if (!localStorage.getItem('el-sbobinator.web.gemini-keys.v1')) localStorage.setItem('el-sbobinator.web.gemini-keys.v1', key);
      } catch {
        // about:blank and other opaque origins have no localStorage.
      }
    }, DUMMY_KEY);
    await provide(context);
  },
});

export { expect } from '@playwright/test';
