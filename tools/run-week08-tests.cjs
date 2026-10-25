/* Ejecuta pruebas reales y genera el indice de evidencia despues de Jest. */
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const directory = join(process.cwd(), 'reports', 'week-08');
mkdirSync(directory, { recursive: true });
const jsonPath = join(directory, 'generated-week08-jest.json');
const storagePath = join(directory, 'generated-week08-storage.json');
const syncPath = join(directory, 'generated-week08-sync.json');
function collectTests(root) {
  const { readdirSync } = require('node:fs');
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? collectTests(path) : /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
// Conservar todos los tests acumulados; sólo excluir hitos posteriores y pruebas privadas.
const suites = [...collectTests('src'), ...collectTests('course-tests')]
  .filter((path) => !/week-(09|10|11|12|13)\.test\.ts$/.test(path) && !path.includes('hidden'));
const jestArgs = ['--ci', '--runInBand', '--no-watchman', '--cacheDirectory', '.jest-cache',
  '--json', '--outputFile', jsonPath, '--runTestsByPath', ...suites];
// Si Jest no llega a producir resultados se aborta; nunca se reutiliza un reporte anterior.
const { rmSync } = require('node:fs');
for (const path of [jsonPath, storagePath, syncPath, join(directory, 'migration-tests.json')]) rmSync(path, { force: true });
const execution = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), ...jestArgs], {
  env: { ...process.env, CAMPUSOPS_STORAGE_OBSERVATIONS: storagePath, CAMPUSOPS_SYNC_OBSERVATIONS: syncPath },
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
const output = (execution.stdout || '') + (execution.stderr || '');
writeFileSync(join(directory, 'generated-week08-output.log'), output);
process.stdout.write(output);
if (execution.error) throw execution.error;
const results = JSON.parse(readFileSync(jsonPath, 'utf8'));
const storage = JSON.parse(readFileSync(storagePath, 'utf8'));
const sync = JSON.parse(readFileSync(syncPath, 'utf8'));
const tests = results.testResults.flatMap((suite) => suite.assertionResults.map((test) => ({ ...test, file: suite.name })));
const command = 'node tools/run-week08-tests.cjs';
const cases = [
  ['offline-notes-preservation', 'sync-notes:', 'failure', 'La nota guardada sin conexión permanece localmente o confirmada en servidor; confirmar start no autoriza perderla.', sync.observations.notes],
  ['offline-restart', 'storage-restart:', 'nominal', 'Misma base, intención, notas, referencias y operationId después de cerrar y reabrir SQLite; lectura desde otro proceso.', storage.observations.restart],
  ['valid-migration', 'storage-migration:', 'nominal', 'Migrar de v1 a v2 conservando incidencias y operaciones; segunda migración sin cambios.', storage.observations.migration],
  ['failed-migration-rollback', 'storage-migration:', 'failure', 'La falla después del DDL revierte tablas, columnas, filas y versión; reabrir y recuperar conserva los datos.', storage.observations.migration],
  ['concurrent-reassignment', 'sync-reassignment:', 'failure', 'Reasignación remota conservada, intención local pendiente y conflicto informado en aplicación aun si el backend devuelve 403.', sync.observations.reassignment],
  ['independent-changes', 'sync-independent:', 'nominal', 'Combinar inicio local y prioridad remota sin mutar entradas. El repositorio de la app utiliza la misma politica compartida; ver tambien workspace-merge.', sync.observations.independent],
  ['repeated-operation', 'sync-confirmed:', 'boundary', 'Reenviar misma identidad y baseVersion: HTTP 201/200, un solo efecto por inicio y comentario; retirar operación confirmada, foto aún pendiente.', sync.observations.confirmed],
  ['lost-response-after-commit', 'sync-lost-response:', 'failure', 'Tras timeout el servidor ya avanzó a v2; cola idéntica tras reabrir; replay con mismo ID confirma sin segundo efecto.', sync.observations.lostResponse],
  ['network-outage', 'sync-network:', 'failure', 'Red caída conserva toda la cola; reconectar confirma usando la identidad original.', sync.observations.network],
  ['version-conflict-409', 'sync-version-conflict:', 'boundary', 'HTTP 409 informa conflicto y conserva intención local y prioridad remota.', sync.observations.versionConflict],
  ['author-session', 'sync-author:', 'boundary', 'Otra sesión no envía acciones ni retira operaciones de un autor distinto.', sync.observations.author],
  ['identity-reuse-different-payload', 'sync-key-reuse:', 'failure', 'SQLite rechaza identidad con contenido distinto; backend devuelve 409 idempotency_key_reused sin otro efecto.', sync.observations.keyReuse],
  ['json-content-and-order', 'sync-json-boundaries:', 'boundary', 'Objetos se comparan por contenido; ausencia difiere de null; arrays mantienen orden; campos conflictivos salen ordenados.', sync.observations.jsonBoundaries],
  ['deduplication-first-wins', 'sync-deduplication:', 'boundary', 'Conservar primera identidad y orden sin mutar entradas. La validación de contenido corresponde a almacenamiento/backend.', sync.observations.deduplication],
];
const checks = cases.map(([id, prefix, scenarioType, expected, observed]) => {
  const test = tests.find((item) => item.fullName.includes(prefix));
  const passed = test?.status === 'passed';
  return {
    id, status: passed ? 'pass' : 'fail', scenarioType, command,
    test: test?.fullName || prefix, expected,
    evidence: test ? `${test.status}: ${test.fullName}. Observación adjunta en observed; fallos en failureMessages.` : 'La prueba no se ejecutó.',
    observed: observed ?? null, failureMessages: test?.failureMessages || [],
  };
});
const regressions = tests.filter((test) => !test.file.includes('syncPendingOperations.test.ts') && !test.file.includes('sqliteOfflineStore.test.ts') && !test.file.endsWith('week-08.test.ts'));
checks.push({ id: 'week06-regression', status: regressions.length && regressions.every((test) => test.status === 'passed') ? 'pass' : 'fail',
  scenarioType: 'boundary', command,
  expected: 'Conservar todas las pruebas acumuladas hasta semana 6, incluidas sesión, login/logout, permisos y renovación compartida.',
  evidence: `${regressions.filter((test) => test.status === 'passed').length}/${regressions.length} pruebas de regresión aprobadas.`,
  observed: regressions.map(({ fullName, status }) => ({ test: fullName, status })),
});
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (sha.status !== 0) throw new Error('No se pudo obtener el SHA');
const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
const extraCases = [
  ['app-offline-restart', 'workspace-offline:', 'failure'],
  ['app-independent-merge', 'workspace-merge:', 'boundary'],
  ['app-session-isolation', 'workspace-logout:', 'boundary'],
  ['invalid-server-receipt', 'sync-receipt-identity:', 'failure'],
  ['session-change-during-sync', 'workspace-session-race:', 'boundary'],
  ['atomic-note-handoff', 'storage-followup:', 'nominal'],
  ['atomic-note-handoff-rollback', 'storage-followup-rollback:', 'failure'],
];
for (const [id, prefix, scenarioType] of extraCases) {
  const test = tests.find((item) => item.fullName.includes(prefix));
  checks.push({ id, scenarioType, command, status: test?.status === 'passed' ? 'pass' : 'fail',
    expected: test?.fullName || prefix, evidence: test ? `${test.status}: ${test.fullName}` : 'Prueba no ejecutada.',
    observed: { status: test?.status, failureMessages: test?.failureMessages || [] },
  });
}
const report = {
  schemaVersion: 1, week: 8, commitSha: sha.stdout.trim(), generatedAt: new Date().toISOString(),
  scope: 'SQLite real en disco, backend HTTP local en proceso independiente y lógica real de aplicación. Sesión segura y reloj sustituidos por dobles. Sin prueba nativa en teléfono/emulador. Consultar workingTreeAtExecution.',
  nodeVersion: process.version, command, workingTreeAtExecution: dirty.stdout.trim(),
  status: results.success && checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
  summary: { suites: results.numTotalTestSuites, passedSuites: results.numPassedTestSuites, failedSuites: results.numFailedTestSuites,
    tests: results.numTotalTests, passed: results.numPassedTests, failed: results.numFailedTests },
  checks,
};
writeFileSync(join(directory, 'migration-tests.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`\nÍndice real generado: reports/week-08/migration-tests.json\n${JSON.stringify(report.summary)}\n`);
// Un reporte correctamente escrito no convierte una prueba fallida en éxito.
process.exitCode = execution.status === 0 && report.status === 'pass' ? 0 : 1;
