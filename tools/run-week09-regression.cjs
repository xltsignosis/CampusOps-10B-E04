const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, basename } = require('node:path');
const temporary = mkdtempSync(join(tmpdir(), 'campusops-regression-'));
const reportPath = 'reports/week-09/regression.json';
mkdirSync('reports/week-09', { recursive: true });
rmSync(reportPath, { force: true });
try {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (git.status !== 0) throw new Error('Cannot identify revision');
  const execution = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--ci', '--runInBand', '--no-watchman',
    '--cacheDirectory', '.jest-cache', '--json', '--outputFile', join(temporary, 'jest.json'),
    '--testPathIgnorePatterns', 'course-tests/public/week-(10|11|12|13).test.ts', '/course-tests/hidden/'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write((execution.stdout || '') + (execution.stderr || ''));
  if (execution.error) throw execution.error;
  const results = JSON.parse(readFileSync(join(temporary, 'jest.json'), 'utf8'));
  const report = { schemaVersion: 1, week: 9, commitSha: git.stdout.trim(), generatedAt: new Date().toISOString(),
    scope: 'All existing suites through week 09. Future-week contracts remain unchanged and are outside this milestone.',
    status: execution.status === 0 && results.success ? 'pass' : 'fail',
    summary: { suites: results.numTotalTestSuites, passedSuites: results.numPassedTestSuites, tests: results.numTotalTests, passed: results.numPassedTests, failed: results.numFailedTests },
    checks: results.testResults.map((suite) => ({ id: basename(suite.name), status: suite.status === 'passed' ? 'pass' : 'fail',
      scenarioType: /retry|resilience|failures|syncPending|security/.test(suite.name) ? 'failure' : 'nominal',
      command: 'npm run test:week09:regression', evidence: suite.assertionResults.length + ' assertions; suite ' + suite.status })) };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status === 'pass' ? 0 : 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
