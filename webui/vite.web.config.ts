import { defineConfig } from 'vite';
import { createViteConfig } from './vite.config.ts';

// Static web build: everything runs in the page (src/web/webHost.ts), output in dist-web.
export default defineConfig(createViteConfig('web'));
