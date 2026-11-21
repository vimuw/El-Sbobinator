import { mergeConfig } from 'vite';
import { createViteConfig } from './vite.config.ts';

// Static web build for Playwright plus a fixed-name module entry for specs that
// compute reference values in the page (see e2e/sourceModules.ts).
export default mergeConfig(createViteConfig('web'), {
  build: {
    emptyOutDir: true,
    rolldownOptions: {
      input: { 'e2e-modules': 'e2e/sourceModules.ts' },
      // The modules entry keeps every export for page.evaluate imports.
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: (chunk: { name: string }) => chunk.name === 'e2e-modules' ? 'e2e-modules.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
