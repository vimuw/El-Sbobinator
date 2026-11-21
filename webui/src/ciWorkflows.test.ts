import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The CI scripts and workflows live outside webui; plain JavaScript and YAML, read as text.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const importScript = (path: string) => import(/* @vite-ignore */ new URL(`../../${path}`, import.meta.url).href);

const CI = read('.github/workflows/build.yml');
const WEB_RELEASE = read('.github/workflows/web-release.yml');
const WEB_STAGING = read('.github/workflows/web-staging.yml');

/** The lines of one step, from its "- name:" to the next step. */
function step(workflow: string, name: string): string {
  const parts = workflow.split(`- name: ${name}`);
  expect(parts.length, `step "${name}"`).toBe(2);
  return parts[1].split('\n      - name:')[0];
}

function jobs(workflow: string): Record<string, { needs: string[]; condition: string; body: string }> {
  const body = workflow.split('\njobs:\n')[1];
  const found: Record<string, { needs: string[]; condition: string; body: string }> = {};
  for (const match of body.matchAll(/^ {2}([\w-]+):\n((?:(?! {2}[\w-]+:\n).*\n?)*)/gm)) {
    const needs = /^ {4}needs: \[([^\]]*)\]/m.exec(match[2]);
    found[match[1]] = {
      needs: needs ? needs[1].split(',').map(need => need.trim()) : [],
      condition: /^ {4}if: (.+)$/m.exec(match[2])?.[1] ?? '',
      body: match[2],
    };
  }
  return found;
}

function expectPinnedActions(workflow: string) {
  const uses = [...workflow.matchAll(/uses: (\S+)/g)].map(match => match[1]);
  expect(uses.length).toBeGreaterThan(0);
  for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
}

function expectInOrder(workflow: string, markers: string[]) {
  const positions = markers.map(marker => {
    const index = workflow.indexOf(marker);
    expect(index, marker).toBeGreaterThanOrEqual(0);
    return index;
  });
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

const PUBLIC_ON_GITHUB = ['action-gh-release', 'upload-artifact', 'gh release', 'contents: write'];

describe('CI workflow', () => {
  it('checks the web site with pinned actions and read-only permissions', () => {
    expectPinnedActions(CI);
    expect(CI).toContain('permissions:\n  contents: read');
    const ci = jobs(CI);
    expect(ci.checks.body).toContain('npm run check');
    expect(ci['web-checks'].body).toContain('npm run build:web');
    expect(ci['web-checks'].body).toContain('npm run test:e2e:web');
    expect(ci.audit.body).toContain('node scripts/npm_audit.mjs');
  });

  it('builds no desktop app and releases nothing', () => {
    expect(CI).not.toMatch(/python|setup-python|build_release|tags:/);
    for (const text of ['action-gh-release', 'gh release', 'contents: write']) expect(CI).not.toContain(text);
  });

  // Main's branch protection requires the "Dependency gate" check by name.
  it('gates on every check, including when some were skipped', () => {
    const ci = jobs(CI);
    const gate = ci['dependency-gate'];
    expect(gate.body).toContain('name: Dependency gate');
    expect(gate.condition).toBe('always()');
    const checkJobs = Object.keys(ci).filter(name => name !== 'dependency-gate');
    expect(new Set(gate.needs)).toEqual(new Set(checkJobs));
    expect(gate.body).toContain("['checks', 'web-checks', 'audit']");
    expect(new Set(checkJobs)).toEqual(new Set(['change-scope', 'checks', 'web-checks', 'audit']));
    // A plain if: implies success(), so a skipped ancestor would skip the gate itself.
    for (const [name, job] of Object.entries(ci)) {
      if (job.needs.some(need => ci[need].condition)) expect(job.condition, name).toMatch(/always\(\)|!cancelled\(\)/);
    }
  });
});

describe('CI change scope', () => {
  it('exempts only documentation', async () => {
    const { classify } = await importScript('scripts/ci_change_scope.mjs');
    expect(classify(['README.md', 'docs/web/STATO.md'])).toEqual({ docs_only: true });
    expect(classify(['README.md', 'webui/src/App.tsx'])).toEqual({ docs_only: false });
    expect(classify(['docs/diagram.png'])).toEqual({ docs_only: false });
    expect(classify(['.github/workflows/build.yml'])).toEqual({ docs_only: false });
    // An unknown or empty range runs every check.
    expect(classify(null)).toEqual({ docs_only: false });
    expect(classify([])).toEqual({ docs_only: false });
  });

  it('compares the range of pull requests and branch pushes only', async () => {
    const { revisionRange } = await importScript('scripts/ci_change_scope.mjs');
    expect(revisionRange({ EVENT_NAME: 'pull_request', PR_BASE_SHA: 'a', PR_HEAD_SHA: 'b' })).toBe('a...b');
    expect(revisionRange({ EVENT_NAME: 'push', EVENT_REF: 'refs/heads/main', BEFORE_SHA: 'a', CURRENT_SHA: 'b' })).toBe('a..b');
    // A new branch has no previous commit.
    expect(revisionRange({ EVENT_NAME: 'push', EVENT_REF: 'refs/heads/main', BEFORE_SHA: '0'.repeat(40), CURRENT_SHA: 'b' })).toBeNull();
    expect(revisionRange({ EVENT_NAME: 'push', EVENT_REF: 'refs/tags/web-v1.0.0', BEFORE_SHA: 'a', CURRENT_SHA: 'b' })).toBeNull();
    expect(revisionRange({ EVENT_NAME: 'schedule' })).toBeNull();
    expect(revisionRange({ EVENT_NAME: 'pull_request' })).toBeNull();
  });
});

describe('npm audit exceptions', () => {
  const picomatch = { source: 1247710, name: 'picomatch', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', range: '<=4.0.7' };
  const report = { vulnerabilities: { picomatch: { via: [picomatch] }, vite: { via: ['picomatch', 'tinyglobby'] } } };
  const devLock = { packages: { 'node_modules/picomatch': { dev: true }, 'node_modules/vite': { dev: true } } };

  it('tolerates an unpatched advisory in dev tooling only while it is unpatched and dev-only', async () => {
    const { auditBlockers, exceptedPackages } = await importScript('scripts/npm_audit.mjs');
    expect(exceptedPackages(report)).toEqual(['picomatch']);
    expect(auditBlockers(report, devLock, { picomatch: '4.0.7' })).toEqual([]);
    const patched = auditBlockers(report, devLock, { picomatch: '4.0.8' });
    expect(patched).toHaveLength(1);
    expect(patched[0]).toContain('4.0.8');
    expect(auditBlockers(report, devLock, { picomatch: null })).toHaveLength(1);
    const shipped = auditBlockers(report, { packages: { 'node_modules/picomatch': { dev: true }, 'node_modules/some-runtime/node_modules/picomatch': { dev: false } } }, { picomatch: '4.0.7' });
    expect(shipped).toHaveLength(1);
    expect(shipped[0]).toContain('some-runtime');
  });

  it('fails on any other advisory or an audit without advisories', async () => {
    const { auditBlockers } = await importScript('scripts/npm_audit.mjs');
    const other = { vulnerabilities: { picomatch: { via: [picomatch] }, lodash: { via: [{ url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' }] } } };
    expect(auditBlockers(other, devLock, { picomatch: '4.0.7' })).toEqual(['lodash: GHSA-xxxx-yyyy-zzzz']);
    // The exception's id on another package.
    expect(auditBlockers({ vulnerabilities: { other: { via: [{ ...picomatch, name: 'other' }] } } }, devLock, { picomatch: '4.0.7' })).toHaveLength(1);
    expect(auditBlockers({ error: { code: 'ENOTFOUND' } }, devLock, {})).toHaveLength(1);
  });
});

describe('web release workflow', () => {
  it('runs only for web-v* tags', () => {
    const trigger = WEB_RELEASE.split('\non:\n')[1].split('\npermissions:')[0];
    expect([...trigger.matchAll(/^\s+- '([^']+)'$/gm)].map(match => match[1])).toEqual(['web-v*']);
    expect(trigger).not.toMatch(/branches|pull_request/);
  });

  it('pins actions and deploys only after the tests and the build', () => {
    expectPinnedActions(WEB_RELEASE);
    expect(WEB_RELEASE).toContain('permissions:\n  contents: read');
    expectInOrder(WEB_RELEASE, [
      'git merge-base --is-ancestor',
      'npm run typecheck',
      'npm test',
      'npm run test:e2e:web',
      'npm run build:web',
      'cloudflare/wrangler-action@',
      '- name: Check that elsbobinator.com serves the new version',
    ]);
    expect(WEB_RELEASE).toContain('https://elsbobinator.com/version.json');
    // Every attempt gives up on its own: a stalled connection must not hold the loop until the job's timeout.
    const curls = step(WEB_RELEASE, 'Check that elsbobinator.com serves the new version').match(/curl [^\n]*/g) ?? [];
    expect(curls.length).toBeGreaterThan(0);
    for (const curl of curls) expect(curl).toMatch(/--max-time \d+\b/);
    expect(WEB_RELEASE).toContain('EL_SBOBINATOR_WEB_VERSION: ${{ github.ref_name }}');
    expect(WEB_RELEASE).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(WEB_RELEASE).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(WEB_RELEASE).toContain('--project-name=elsbobinator --branch=main');
  });

  it('builds Drive from the repository variable and checks it', () => {
    const variable = 'EL_SBOBINATOR_GOOGLE_CLIENT_ID: ${{ vars.EL_SBOBINATOR_GOOGLE_CLIENT_ID }}';
    const build = step(WEB_RELEASE, 'Build the static site');
    expect(build).toContain(variable);
    expect(build).toContain('npm run build:web');
    // The client ID is public: never a secret, which would also hide it from the build logs.
    expect(WEB_RELEASE).not.toContain('secrets.EL_SBOBINATOR_GOOGLE_CLIENT_ID');
    const check = step(WEB_RELEASE, 'Check the Google Drive sync');
    expect(check).toContain(variable);
    const [withDrive, withoutDrive] = check.split('\n          else\n');
    expect(withDrive).toContain('if [ -n "$EL_SBOBINATOR_GOOGLE_CLIENT_ID" ]');
    expect(withDrive).toContain('test -f dist-web/drive-auth.html');
    expect(withDrive).toContain('exit 1');
    // Without the variable the release goes on without Drive.
    expect(withoutDrive).toContain('::warning::');
    expect(withoutDrive).not.toContain('exit');
    expectInOrder(WEB_RELEASE, ['npm run build:web', '- name: Check the Google Drive sync', 'cloudflare/wrangler-action@']);
  });

  it('builds reports from the repository variable and checks them', () => {
    const variable = 'EL_SBOBINATOR_SENTRY_DSN: ${{ vars.EL_SBOBINATOR_SENTRY_DSN }}';
    expect(step(WEB_RELEASE, 'Build the static site')).toContain(variable);
    // The DSN is public: a secret would also hide it from the build logs.
    expect(WEB_RELEASE).not.toContain('secrets.EL_SBOBINATOR_SENTRY_DSN');
    const check = step(WEB_RELEASE, 'Check the feedback and error reports');
    expect(check).toContain(variable);
    const [withReports, withoutReports] = check.split('\n          else\n');
    expect(withReports).toContain('test -f ../functions/api/report.ts');
    expect(withReports).toContain('dist-web/_headers');
    expect(withReports).toContain('exit 1');
    // Without the variable the release goes on with reports by email.
    expect(withoutReports).toContain('::warning::');
    expect(withoutReports).not.toContain('exit');
    expect(withoutReports).toContain('reports by email');
    expect(withoutReports).not.toContain('Google');
    expectInOrder(WEB_RELEASE, ['npm run build:web', '- name: Check the feedback and error reports', 'cloudflare/wrangler-action@']);
  });

  it('publishes nothing on GitHub', () => {
    for (const text of PUBLIC_ON_GITHUB) expect(WEB_RELEASE).not.toContain(text);
  });
});

describe('web staging workflow', () => {
  it('is manual and never deploys production', () => {
    const trigger = WEB_STAGING.split('\non:\n')[1].split('\npermissions:')[0];
    expect(trigger.trim()).toBe('workflow_dispatch:');
    expect(WEB_STAGING).toContain('permissions:\n  contents: read');
    expectPinnedActions(WEB_STAGING);
    expect(WEB_STAGING).toContain('--project-name=elsbobinator --branch=staging');
    expect(WEB_STAGING).not.toContain('--branch=main');
    // A staging build carries no web-v* version, so the site labels itself a preview.
    expect(WEB_STAGING).not.toContain('EL_SBOBINATOR_WEB_VERSION');
    // With Drive and the reports, so the /api/drive and /api/report Functions can be tried first.
    const build = step(WEB_STAGING, 'Build the static site');
    expect(build).toContain('EL_SBOBINATOR_GOOGLE_CLIENT_ID: ${{ vars.EL_SBOBINATOR_GOOGLE_CLIENT_ID }}');
    expect(build).toContain('EL_SBOBINATOR_SENTRY_DSN: ${{ vars.EL_SBOBINATOR_SENTRY_DSN }}');
    expectInOrder(WEB_STAGING, ['npm run typecheck', 'npm test', 'npm run test:e2e:web', 'npm run build:web', 'cloudflare/wrangler-action@']);
    for (const text of PUBLIC_ON_GITHUB) expect(WEB_STAGING).not.toContain(text);
  });
});
