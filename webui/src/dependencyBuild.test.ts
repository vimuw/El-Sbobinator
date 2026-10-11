import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('build dependency boundary', () => {
  it.each(['1.0.0', '2.0.0'])('requires the installed graph to match the lock (%s)', (installed) => {
    const temporary = mkdtempSync(join(tmpdir(), 'el-sbobinator-dependencies-'));
    const webui = join(temporary, 'webui');
    try {
      mkdirSync(join(temporary, 'scripts'));
      mkdirSync(join(webui, 'node_modules', 'sample'), { recursive: true });
      const actualPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      writeFileSync(join(temporary, 'scripts', 'verify_node_dependencies.mjs'), readFileSync(new URL('../../scripts/verify_node_dependencies.mjs', import.meta.url)));
      writeFileSync(join(webui, 'package.json'), JSON.stringify({
        name: 'build-fixture', version: '1.0.0', engines: { node: '24.x' },
        scripts: { prebuild: actualPackage.scripts.prebuild, build: 'node -e "console.log(\'bundle-produced\')"' },
        dependencies: { sample: '2.0.0' },
      }));
      writeFileSync(join(webui, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3, packages: { '': { name: 'build-fixture' }, 'node_modules/sample': { version: '2.0.0' } },
      }));
      writeFileSync(join(webui, 'node_modules', 'sample', 'package.json'), JSON.stringify({ name: 'sample', version: installed }));
      const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
      const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd run build'] : ['run', 'build'];
      const result = spawnSync(command, args, { cwd: webui, encoding: 'utf8' });
      if (installed === '2.0.0') {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('bundle-produced');
      } else {
        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain('\nbundle-produced\n');
        expect(result.stderr).toContain('lock 2.0.0');
      }
    } finally {
      if (dirname(resolve(temporary)) === resolve(tmpdir()) && basename(temporary).startsWith('el-sbobinator-dependencies-')) {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }, 20000);
});
