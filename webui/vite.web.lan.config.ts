import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import { createViteConfig } from './vite.config.ts';

// The web dev server for phones and tablets on the same network (npm run dev:web:lan). It
// serves HTTPS so the page is a secure context (crypto.randomUUID, crypto.subtle), with the
// certificate scripts/dev_https_cert.py issues for this PC's current addresses.
const certDir = new URL('./.certs/', import.meta.url);
const certFile = (name: string) => {
  const file = new URL(name, certDir);
  if (!existsSync(file)) throw new Error(`Missing webui/.certs/${name}: run python scripts/dev_https_cert.py first.`);
  return readFileSync(file);
};

export default defineConfig(mergeConfig(createViteConfig('web'), {
  plugins: [{
    name: 'web-lan-dev-ca',
    apply: 'serve',
    // Opening this address in Safari offers the CA as a profile to install and then trust.
    configureServer(server) {
      server.middlewares.use('/el-sbobinator-dev-ca.crt', (_req, res) => {
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="el-sbobinator-dev-ca.crt"');
        res.end(certFile('ca.crt'));
      });
    },
  }],
  server: {
    host: true,
    https: { key: certFile('server-key.pem'), cert: certFile('server.crt') },
  },
}));
