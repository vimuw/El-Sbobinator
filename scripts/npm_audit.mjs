// Audits the complete npm lock (npm audit --package-lock-only) and fails on any advisory
// that NPM_AUDIT_EXCEPTIONS does not cover. The report goes to build/dependency-audit/npm.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm advisories with no patched release that reach only build/test tooling, as
// { GHSA id: [package, last vulnerable release] }. Each one is tolerated only while that
// release is still the package's latest and every copy in package-lock.json is dev-only:
// once a fix ships, or the package reaches the shipped bundle, the audit fails again.
export const NPM_AUDIT_EXCEPTIONS = {
  // picomatch ReDoS through repeated extglobs; pulled in by vite and vitest only.
  'GHSA-fc5q-39xc-vjpf': ['picomatch', '4.0.7'],
};

const ghsaOf = source => String(source.url ?? '').replace(/\/+$/, '').split('/').pop();

/** Packages named by an exception that the report flags, whose latest release must be looked up. */
export function exceptedPackages(audit, exceptions = NPM_AUDIT_EXCEPTIONS) {
  const packages = new Set();
  for (const vulnerability of Object.values(audit.vulnerabilities ?? {})) {
    for (const source of vulnerability.via ?? []) {
      if (typeof source === 'object' && exceptions[ghsaOf(source)]) packages.add(exceptions[ghsaOf(source)][0]);
    }
  }
  return [...packages];
}

/** Advisories of an `npm audit --json` report that the exceptions do not cover. */
export function auditBlockers(audit, lock, latestVersions, exceptions = NPM_AUDIT_EXCEPTIONS) {
  const vulnerabilities = audit.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object' || !Object.keys(vulnerabilities).length) {
    return ['npm audit non ha restituito un elenco di avvisi'];
  }
  const lockPackages = lock.packages ?? {};
  const blockers = [];
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    for (const source of vulnerability.via ?? []) {
      // Inherited from another flagged package, judged at its own entry.
      if (typeof source === 'string') continue;
      const ghsa = ghsaOf(source);
      const exception = exceptions[ghsa];
      if (!exception || exception[0] !== name) {
        blockers.push(`${name}: ${ghsa || source.title || 'avviso'}`);
        continue;
      }
      const [pkg, lastVulnerable] = exception;
      const latest = latestVersions[pkg];
      if (latest !== lastVulnerable) {
        blockers.push(`${name}: ${ghsa} ha una versione nuova (${latest || 'sconosciuta'}): aggiornala`);
      }
      const shipped = Object.entries(lockPackages)
        .filter(([path, entry]) => path.endsWith(`node_modules/${pkg}`) && entry.dev !== true)
        .map(([path]) => path);
      if (shipped.length) blockers.push(`${name}: ${ghsa} non solo negli strumenti di sviluppo (${shipped.join(', ')})`);
    }
  }
  return blockers;
}

function npm(args, cwd) {
  // npm is a .cmd script on Windows, which spawnSync can run only through the shell.
  return process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`], { cwd, encoding: 'utf8' })
    : spawnSync('npm', args, { cwd, encoding: 'utf8' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const webui = resolve(root, 'webui');
  const report = resolve(root, 'build', 'dependency-audit');
  mkdirSync(report, { recursive: true });
  const result = npm(['audit', '--package-lock-only', '--json'], webui);
  writeFileSync(resolve(report, 'npm.json'), result.stdout ?? '');
  if (result.status === 0) {
    console.log('[OK] Audit npm: nessun avviso noto.');
  } else {
    let blockers;
    try {
      const audit = JSON.parse(result.stdout);
      const lock = JSON.parse(readFileSync(resolve(webui, 'package-lock.json'), 'utf8'));
      const latest = Object.fromEntries(exceptedPackages(audit).map(pkg => {
        const view = npm(['view', pkg, 'version'], webui);
        return [pkg, view.status === 0 ? view.stdout.trim() || null : null];
      }));
      blockers = auditBlockers(audit, lock, latest);
    } catch (error) {
      blockers = [`audit npm illeggibile: ${error instanceof Error ? error.message : String(error)}`];
    }
    for (const blocker of blockers) console.error(`[ERRORE] Avviso npm: ${blocker}`);
    if (blockers.length) {
      console.error(`Audit dipendenze fallito: consulta ${report}`);
      process.exitCode = 1;
    } else {
      console.log(`[AVVISO] Audit npm: tollerati solo avvisi senza correzione negli strumenti di sviluppo (${Object.keys(NPM_AUDIT_EXCEPTIONS).sort().join(', ')}).`);
    }
  }
}
