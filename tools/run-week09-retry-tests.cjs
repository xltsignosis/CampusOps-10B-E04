/* Evidencia ejecutable del integrante 2: política, transporte e idempotencia. */
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const directory = join(process.cwd(), 'reports', 'week-09');
const reportPath = join(directory, 'retry-metrics.json');
const temporary = mkdtempSync(join(tmpdir(), 'campusops-retry-'));
const resultsPath = join(temporary, 'jest.json');
const observationsPath = join(temporary, 'observations.json');
const command = 'npm run test:week09:retry';
mkdirSync(directory, { recursive: true });
// Un fallo de ejecución no debe dejar un reporte de éxito de una ejecución anterior.
rmSync(reportPath, { force: true });

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('No se pudo identificar la versión local.');
  return result.stdout.trim();
}

try {
  const commitSha = git(['rev-parse', 'HEAD']);
  const workingTreeAtExecution = git(['status', '--short']);
  const execution = spawnSync(process.execPath, [require.resolve('jest/bin/jest'),
    '--ci', '--runInBand', '--no-watchman', '--cacheDirectory', '.jest-cache',
    '--json', '--outputFile', resultsPath, '--runTestsByPath',
    'src/application/retryPolicy.test.ts', 'src/infrastructure/incidentClient.retry.test.ts',
  ], {
    env: { ...process.env, CAMPUSOPS_RETRY_OBSERVATIONS: observationsPath },
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  process.stdout.write((execution.stdout || '') + (execution.stderr || ''));
  if (execution.error) throw execution.error;
  const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const observations = JSON.parse(readFileSync(observationsPath, 'utf8'));
  const tests = results.testResults.flatMap((suite) => suite.assertionResults);
  const cases = [
    ['bounded-attempts', 'retry-bound:', 'bounded', 'boundary', 'Cuatro envíos y tres esperas de 250/500/1000 ms; nunca programar el quinto envío.'],
    ['configurable-limits', 'retry-config:', 'configured', 'boundary', 'Máximo de tres envíos con esperas de 100/150 ms configuradas.'],
    ['retry-after-seconds', 'retry-after-seconds:', 'header-seconds', 'nominal', 'Interpretar Retry-After: 2 como 2000 ms.'],
    ['retry-after-date', 'retry-after-date:', 'header-date', 'nominal', 'Interpretar fecha HTTP con reloj controlado: espera de 3000 ms.'],
    ['retry-after-invalid', 'retry-after-invalid:', 'header-invalid', 'failure', 'Encabezado inválido usa backoff finito de 250 ms.'],
    ['retry-after-past', 'retry-after-past:', 'header-past', 'boundary', 'Fecha pasada no elimina el backoff progresivo de 250 ms.'],
    ['retry-after-exceeds-limit', 'retry-after-too-long:', 'headerExceedsLimit', 'boundary', 'Detenerse sin recortar una espera de servidor de 11000 ms que excede el máximo de 10000 ms.'],
    ['post-needs-identity', 'retry-post-identity:', 'missingIdentity', 'boundary', 'POST con clave vacía, corta o de espacios se rechaza antes del primer envío.'],
    ['immutable-payload', 'retry-post-snapshot:', 'immutablePayload', 'boundary', 'Conservar los mismos bytes y clave aunque se mute el borrador durante la operación.'],
    ['resolution-identity', 'retry-action-resolve:', 'action-resolve', 'nominal', 'Reintentar resolución con misma ruta, clave, contenido y baseVersion.'],
    ['close-identity', 'retry-action-close:', 'action-close', 'nominal', 'Reintentar cierre con misma ruta, clave, contenido y baseVersion.'],
    ['network-bound', 'retry-network:', 'network', 'failure', 'Desconexión termina en el cuarto envío y omite el error original de los registros.'],
    ['shared-auth-budget', 'retry-auth-budget:', 'authBudget', 'boundary', 'El reenvío tras renovar sesión consume el mismo límite de cuatro envíos.'],
    ['sanitized-telemetry', 'retry-sanitized:', 'sanitized', 'boundary', 'Registrar sólo metadatos técnicos sin clave de operación, actor, credenciales ni diagnóstico.'],
    ['timeout-and-timers', 'retry-timers:', 'timeout', 'failure', 'Limitar también el tiempo de lectura del cuerpo; no enviar antes de la espera ni dejar temporizadores pendientes.'],
    ['http-retry-after', 'retry-http-header:', 'httpRetryAfter', 'nominal', 'Con el backend local real, esperar al menos 1000 ms entre el 429 y el siguiente envío.'],
  ];
  const checks = cases.map(([id, prefix, observation, scenarioType, expected]) => {
    const test = tests.find((item) => item.fullName.includes(prefix));
    const observed = observations[observation];
    return { id, scenarioType, command, expected,
      status: test?.status === 'passed' && observed !== undefined ? 'pass' : 'fail',
      evidence: test ? `${test.status}: ${test.fullName}` : `Prueba no ejecutada: ${prefix}`,
      observed: observed ?? null, failureMessages: test?.failureMessages || [],
    };
  });
  const report = {
    schemaVersion: 1, week: 9, commitSha, generatedAt: new Date().toISOString(), command,
    scope: 'Integrante 2: planificación y ejecución de reintentos, identidad y contenido estables, registros sanitizados. Reloj virtual para límites y HTTP local con reloj real para Retry-After.',
    revisionNote: 'commitSha identifica el HEAD base; workingTreeAtExecution registra los cambios locales comprobados. Actualizar tras guardar el código para la entrega final del equipo.',
    workingTreeAtExecution, nodeVersion: process.version,
    status: results.success && checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    policy: { firstAttempt: 1, maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 10000,
      retryAfter: 'Segundos enteros o fecha HTTP en 429/503; máximo entre backoff y espera del servidor. Si excede maxDelayMs no se reintenta.',
      retryable: ['timeout', 'network', 408, 429, '500..599'],
      identity: 'POST exige clave estable de al menos ocho caracteres no vacíos. Se serializa el cuerpo una sola vez antes de esperar. La cola existente conserva su operationId.',
      exhausted: 'Propagar fallo tipado; la cola existente conserva la operación pendiente para una sincronización explícita posterior.',
    },
    summary: { suites: results.numTotalTestSuites, passedSuites: results.numPassedTestSuites,
      tests: results.numTotalTests, passed: results.numPassedTests, failed: results.numFailedTests },
    checks,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`\nMétricas generadas: reports/week-09/retry-metrics.json\n${JSON.stringify(report.summary)}\n`);
  process.exitCode = execution.status === 0 && report.status === 'pass' ? 0 : 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
