import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const webui = fileURLToPath(new URL('../webui/', import.meta.url));
const lock = JSON.parse(readFileSync(resolve(webui, 'package-lock.json'), 'utf8'));
const issues = [];
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location) continue;
  const manifest = resolve(webui, location, 'package.json');
  if (!existsSync(manifest)) {
    if (!info.optional) issues.push(`${location}: manca (${info.version})`);
    continue;
  }
  const installed = JSON.parse(readFileSync(manifest, 'utf8')).version;
  if (installed !== info.version) issues.push(`${location}: ${installed}, lock ${info.version}`);
}
const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd ls --all --json'] : ['ls', '--all', '--json'];
const npm = spawnSync(command, args, { cwd: webui, encoding: 'utf8' });
if (npm.status !== 0) issues.push(npm.stderr || npm.stdout || String(npm.error));
if (issues.length) {
  console.error(`Dipendenze npm non allineate:\n${issues.join('\n')}`);
  process.exitCode = 1;
} else console.log('[OK] Grafo npm installato allineato a package-lock.json');
