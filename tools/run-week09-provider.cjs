/* Explicit opt-in live check. Never run automatically in deterministic tests/CI. */
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
// Use the actual TypeScript adapter in this isolated CLI without another runtime dependency.
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  module._compile(output.outputText, filename);
};
const { GeocodingClient } = require('../src/infrastructure/geocodingClient.ts');
const reportPath = 'reports/week-09/provider-execution.json';
fs.mkdirSync('reports/week-09', { recursive: true });
fs.rmSync(reportPath, { force: true });
(async () => {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (revision.status !== 0) throw new Error('Cannot identify checked commit');
  let requests = 0;
  let credentialsSent = false;
  const responses = [];
  const client = new GeocodingClient({ provider: 'photon', timeoutMs: 10000, fetchImpl: async (url, init) => {
    requests++;
    credentialsSent ||= Object.keys(init.headers).some((key) => /authorization|course/i.test(key));
    const response = await fetch(url, init);
    const data = await response.clone().json();
    responses.push({ httpStatus: response.status, featureCount: Array.isArray(data.features) ? data.features.length : null });
    return response;
  } });
  const checks = [];
  for (const [id, query, expectedSource] of [
    ['public-reference', 'Ciudad de México', 'provider'],
    ['fictional-no-match', 'CampusOpsE04ZQXNeverland20261031', 'manual'],
  ]) {
    const before = requests;
    const start = Date.now();
    const location = await client.resolve(query, 'Edificio ficticio E04');
    const transport = responses[responses.length - 1];
    const validResponse = transport?.httpStatus === 200 && (expectedSource === 'manual' ? transport.featureCount === 0 : transport.featureCount > 0);
    checks.push({ id, status: location.source === expectedSource && validResponse ? 'pass' : 'fail', scenarioType: expectedSource === 'manual' ? 'failure' : 'nominal',
      command: 'npm run test:week09:provider', evidence: 'Live Photon request with synthetic incident; source=' + location.source,
      observed: { ...transport, source: location.source, hasCoordinates: 'latitude' in location, durationMs: Date.now() - start, requests: requests - before, clock: 'real' } });
    if (id === 'public-reference') {
      const cached = await client.resolve(query, 'Edificio ficticio E04');
      checks.push({ id: 'live-cache', status: location.source === 'provider' && cached === location && requests === before + 1 ? 'pass' : 'fail', scenarioType: 'boundary',
        command: 'npm run test:week09:provider', evidence: 'Second identical query uses adapter cache without an HTTP request.' });
    }
    await new Promise((done) => setTimeout(done, 1100));
  }
  checks.push({ id: 'no-course-credentials', status: credentialsSent ? 'fail' : 'pass', scenarioType: 'boundary', command: 'npm run test:week09:provider', evidence: 'Only Accept header sent to the external provider.' });
  const report = { schemaVersion: 1, week: 9, commitSha: revision.stdout.trim(), generatedAt: new Date().toISOString(),
    provider: 'Photon / Komoot public demo', endpoint: 'https://photon.komoot.io/api/',
    policy: 'https://github.com/komoot/photon#demo-server', attribution: '© OpenStreetMap contributors, ODbL',
    data: 'Synthetic incident E04; public city reference plus invented unmatchable building; no personal data or raw coordinates stored.',
    checks, requests, status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail' };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status === 'pass' ? 0 : 1;
})().catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
