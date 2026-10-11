import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, builtinModules } from 'node:module';

const root = fileURLToPath(new URL('../webui/', import.meta.url));
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };
const issues = new Set();
function track(value, file) {
  if (!value || value.startsWith('.') || value.startsWith('/') || value.startsWith('node:')) return;
  const name = value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0];
  if (!builtinModules.includes(name) && !declared[name]) issues.add(`${relative(root, file)}: ${name} non dichiarato`);
}
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
      const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) track(node.moduleSpecifier.text, file);
        if (ts.isCallExpression(node) && node.arguments.length && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require') && ts.isStringLiteral(node.arguments[0])) track(node.arguments[0].text, file);
        ts.forEachChild(node, visit);
      }
      visit(tree);
    } else if (file.endsWith('.css')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/@(?:import|plugin)\s+["']([^"']+)["']/g)) track(match[1], file);
    }
  }
}
walk(root);
if (issues.size) {
  console.error([...issues].sort().join('\n'));
  process.exitCode = 1;
} else console.log('[OK] Import npm diretti dichiarati nel manifest');
