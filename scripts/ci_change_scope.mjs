// Classifies the CI change range. A change to documentation only skips the checks; the
// Dependency gate still runs and verifies the exemption. An unknown or empty range runs
// every check.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_FILES = new Set(['README.md', 'DISCLAIMER.md']);
const DOCS_SUFFIXES = ['.md', '.rst', '.txt'];

/** Code, dependency files and workflows stay outside the exemption. */
export function isDocumentation(path) {
  return DOCS_FILES.has(path) || (path.startsWith('docs/') && DOCS_SUFFIXES.some(suffix => path.endsWith(suffix)));
}

export function classify(paths) {
  if (!paths?.length) return { docs_only: false };
  return { docs_only: paths.every(isDocumentation) };
}

/** Only pull requests and branch pushes have a range; schedule and manual runs check everything. */
export function revisionRange(env) {
  if (env.EVENT_NAME === 'pull_request') {
    if (env.PR_BASE_SHA && env.PR_HEAD_SHA) return `${env.PR_BASE_SHA}...${env.PR_HEAD_SHA}`;
  } else if (env.EVENT_NAME === 'push' && (env.EVENT_REF ?? '').startsWith('refs/heads/')) {
    const before = env.BEFORE_SHA ?? '';
    if (before && before !== '0'.repeat(40) && env.CURRENT_SHA) return `${before}..${env.CURRENT_SHA}`;
  }
  return null;
}

function changedPaths(range) {
  if (!range) return null;
  try {
    return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', range, '--'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    console.log('Change range unavailable; running all checks.');
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scope = classify(changedPaths(revisionRange(process.env)));
  appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${scope.docs_only}\n`);
  console.log(`Documentation-only exemption: ${scope.docs_only}`);
}
