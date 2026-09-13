import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const UI_ROOT = resolve(__dirname, '..', 'src', 'ui');
const INFRASTRUCTURE_ROOT = resolve(__dirname, '..', 'src', 'infrastructure');
const IMPORT_PATTERN = /import\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const entryPath = join(root, entry);
    if (statSync(entryPath).isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(entryPath);
    }
  }
  return files;
}

function findInfrastructureImports(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf8');
  const violations: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (!specifier || !specifier.startsWith('.')) continue;
    const resolved = resolve(join(filePath, '..'), specifier);
    if (resolved === INFRASTRUCTURE_ROOT || resolved.startsWith(INFRASTRUCTURE_ROOT + '\\') || resolved.startsWith(INFRASTRUCTURE_ROOT + '/')) {
      violations.push(specifier);
    }
  }
  return violations;
}

test('ui layer never imports infrastructure directly', () => {
  const offenders: string[] = [];
  for (const filePath of collectSourceFiles(UI_ROOT)) {
    const violations = findInfrastructureImports(filePath);
    for (const specifier of violations) {
      offenders.push(`${relative(resolve(__dirname, '..'), filePath)} -> '${specifier}'`);
    }
  }
  expect(offenders).toEqual([]);
});
