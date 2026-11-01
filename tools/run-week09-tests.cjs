/* Reproducible fault evidence: real local HTTP plus deterministic unit/UI cases. */
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const temporary = mkdtempSync(join(tmpdir(), 'campusops-week09-'));
const reportPath = join('reports', 'week-09', 'fault-injection.json');
const command = 'npm run test:week09';
mkdirSync(join('reports', 'week-09'), { recursive: true });
rmSync(reportPath, { force: true });
try {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (git.status !== 0) throw new Error('Cannot identify checked commit');
  const execution = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--ci', '--runInBand',
    '--no-watchman', '--cacheDirectory', '.jest-cache', '--json', '--outputFile', join(temporary, 'jest.json'),
    '--runTestsByPath', 'src/infrastructure/geocodingClient.test.ts', 'src/infrastructure/incidentClient.resilience.test.ts',
    'src/ui/IncidentReportForm.resilience.test.tsx', 'src/testing/week09Ui.test.tsx', 'course-tests/public/week-09.test.ts'],
    { env: { ...process.env, CAMPUSOPS_FAULT_OBSERVATIONS: temporary }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write((execution.stdout || '') + (execution.stderr || ''));
  if (execution.error) throw execution.error;
  const result = JSON.parse(readFileSync(join(temporary, 'jest.json'), 'utf8'));
  const checks = result.testResults.flatMap((suite) => suite.assertionResults.map((test, i) => ({
    id: suite.name.replaceAll('\\', '/').split('/').pop() + ':' + i,
    status: test.status === 'passed' ? 'pass' : 'fail',
    scenarioType: /lost|fallback|deadline|disconnect|invalid|http|replay|stale|no-cache/.test(test.fullName) ? 'failure' : 'boundary',
    command, evidence: test.fullName + ': ' + test.status, failureMessages: test.failureMessages,
  })));
  const observed = Object.fromEntries(readdirSync(temporary).filter((name) => name !== 'jest.json').map((name) => [name, JSON.parse(readFileSync(join(temporary, name), 'utf8'))]));
  const report = { schemaVersion: 1, week: 9, commitSha: git.stdout.trim(), generatedAt: new Date().toISOString(), command,
    status: execution.status === 0 && result.success ? 'pass' : 'fail',
    scope: 'Deterministic fixtures, real local HTTP/socket timeouts and rendered React Native components. In-app notices only; no native push or device E2E.',
    summary: { suites: result.numTotalTestSuites, passedSuites: result.numPassedTestSuites, tests: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests },
    checks, observed };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report.summary) + '\n');
  process.exitCode = report.status === 'pass' ? 0 : 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
