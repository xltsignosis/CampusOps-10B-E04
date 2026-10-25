"""Check offline restart on the Android emulator with the real app and SQLite binding.
Requires a debug APK installed and Metro at 8081. Uses only the public fixture app.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

PACKAGE = 'mx.edu.dmi.engineeringapp'
NOTE = 'Native_offline_note_08'
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'reports/week-08'


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--adb', default=str(Path(os.environ.get('LOCALAPPDATA', '')) / 'Android/Sdk/platform-tools/adb.exe'))
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--node', default='node')
    parser.add_argument('--reset-test-data', action='store_true')
    args = parser.parse_args()
    if not args.serial.startswith('emulator-'):
        raise SystemExit('This fixture check only targets an Android emulator.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks = []
    backend = None
    backend_log = (OUTPUT / 'generated-native-backend.log').open('wb')
    base_url = 'http://127.0.0.1:4310'

    def adb(*parts, check=True):
        result = subprocess.run([args.adb, '-s', args.serial, *parts], capture_output=True, timeout=30)
        if check and result.returncode:
            raise RuntimeError(result.stderr.decode('utf-8', errors='replace'))
        return result.stdout

    def api(path, body=None, headers=None):
        request = urllib.request.Request(base_url + path, data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', **(headers or {})})
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.load(response)

    def start_backend():
        nonlocal backend
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', 4310)) == 0:
                raise RuntimeError('Port 4310 is occupied; no existing service was stopped.')
        backend = subprocess.Popen([args.node, 'course-backend/server.mjs'], cwd=ROOT,
            env={**os.environ, 'COURSE_BACKEND_HOST': '127.0.0.1', 'COURSE_BACKEND_PORT': '4310'},
            stdout=backend_log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                if api('/health')['ok']: return
            except (OSError, ValueError): time.sleep(0.2)
        raise RuntimeError('Local backend did not start.')

    def stop_backend():
        nonlocal backend
        if backend:
            backend.terminate()
            backend.wait(timeout=10)
            backend = None

    def ui():
        adb('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/campusops-week08.xml', check=False)
        raw = adb('exec-out', 'cat', '/sdcard/campusops-week08.xml')
        (OUTPUT / 'generated-native-ui.xml').write_bytes(raw)
        return ET.fromstring(raw)

    def wait_node(identifier, text=None, timeout=45):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                for node in ui().iter('node'):
                    key = node.attrib.get('resource-id', '')
                    if key.endswith(identifier) and (text is None or text in node.attrib.get('text', '')):
                        return node
            except (ET.ParseError, RuntimeError, subprocess.TimeoutExpired): pass
            time.sleep(0.4)
        raise RuntimeError('UI element not found: ' + identifier)

    def tap(identifier, text=None):
        node = wait_node(identifier, text)
        left, top, right, bottom = map(int, re.findall(r'\d+', node.attrib['bounds']))
        adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))

    def launch():
        adb('shell', 'am', 'start', '-n', PACKAGE + '/.MainActivity')

    def snapshot(stage):
        adb('shell', 'am', 'force-stop', PACKAGE)
        target = OUTPUT / ('generated-native-' + stage + '.db')
        for suffix in ['', '-wal', '-shm']:
            Path(str(target) + suffix).unlink(missing_ok=True)
        for suffix in ['', '-wal', '-shm']:
            result = subprocess.run([args.adb, '-s', args.serial, 'exec-out', 'run-as', PACKAGE,
                'cat', 'files/SQLite/campusops-offline.db' + suffix], capture_output=True, timeout=15)
            if result.returncode == 0:
                Path(str(target) + suffix).write_bytes(result.stdout)
            elif not suffix:
                raise RuntimeError('Native SQLite database was not created: ' + result.stderr.decode(errors='replace'))
        with sqlite3.connect(target) as db:
            db.row_factory = sqlite3.Row
            return {
                'schemaVersion': db.execute('PRAGMA user_version').fetchone()[0],
                'operations': [dict(row) for row in db.execute('SELECT * FROM pending_operations ORDER BY sequence')],
                'incidents': [dict(row) for row in db.execute('SELECT * FROM local_incidents ORDER BY actor_id, incident_id')],
                'photos': [dict(row) for row in db.execute('SELECT * FROM pending_photo_references')],
            }

    command = subprocess.list2cmdline([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]])
    try:
        print('Preparing Android emulator and local fixture...', flush=True)
        adb('shell', 'input', 'keyevent', '224')
        adb('shell', 'wm', 'dismiss-keyguard')
        adb('shell', 'wm', 'density', '240')
        if args.reset_test_data:
            adb('shell', 'pm', 'clear', PACKAGE)
        adb('reverse', 'tcp:4310', 'tcp:4310')
        adb('reverse', 'tcp:8081', 'tcp:8081')
        start_backend()
        launch()
        print('Waiting for the real app login...', flush=True)
        tap('login-technician-1')
        tap('incident-item-campus-inc-001')
        tap('action-notes')
        adb('shell', 'input', 'text', NOTE)
        adb('shell', 'input', 'keyevent', '4')
        stop_backend()
        tap('action-start')
        wait_node('campusops-notice', 'guardado')
        print('Offline change stored; force-stopping and reopening...', flush=True)
        before = snapshot('before-restart')
        assert before['schemaVersion'] == 2 and len(before['operations']) == 1, before
        assert json.loads(before['operations'][0]['payload_json'])['notes'] == NOTE
        launch()
        wait_node('incident-item-campus-inc-001')
        reopened = snapshot('after-restart')
        assert reopened == before, {'before': before, 'reopened': reopened}
        checks.append({'id': 'android-offline-restart', 'status': 'pass', 'scenarioType': 'failure', 'command': command,
            'evidence': 'Force-stop y reapertura offline conservan exactamente filas, identidad, contenido y version en Expo SQLite nativo.',
            'expected': 'Misma cola e identidad despues del reinicio sin conexion.', 'observed': {'before': before, 'reopened': reopened}})
        start_backend()
        launch()
        print('Connection restored; waiting for server confirmation...', flush=True)
        grant = api('/v1/session/login', {'actorId': 'coordinator-1'})
        headers = {'Authorization': 'Bearer ' + grant['accessToken'], 'X-Course-Actor': grant['actorId']}
        deadline = time.monotonic() + 40
        server = None
        while time.monotonic() < deadline:
            server = api('/v1/incidents/campus-inc-001', headers=headers)
            if server['version'] == 3: break
            time.sleep(0.3)
        assert server and server['version'] == 3, server
        wait_node('campusops-notice', 'confirmados')
        final = snapshot('after-confirmation')
        assert final['operations'] == [], final
        assert server['payload']['notes'] == [{'actorId': 'technician-1', 'text': NOTE}], server
        assert len(server['payload']['history']) == 2, server
        assert json.loads(final['incidents'][0]['base_json'])['version'] == 3, final
        checks.append({'id': 'android-reconnect-confirmation', 'status': 'pass', 'scenarioType': 'boundary', 'command': command,
            'evidence': 'Inicio y comentario se confirman una vez; cola vacia y base local v3 tras reconectar la app.',
            'expected': 'Confirmar inicio y nota sin perder datos ni duplicar efectos.', 'observed': {'final': final, 'server': server}})
        status = 'pass'
    except Exception as error:
        status = 'fail'
        checks.append({'id': 'android-flow', 'status': 'fail', 'scenarioType': 'failure', 'command': command,
            'evidence': str(error), 'expected': 'Flujo nativo completo sin perdida.', 'observed': str(error)})
    finally:
        stop_backend()
        backend_log.close()
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    report = {'schemaVersion': 1, 'week': 8, 'commitSha': sha,
        'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'status': status,
        'device': args.serial, 'scope': 'Android emulator; APK debug, Expo SQLite and SecureStore native bindings, real app and local HTTP backend.', 'checks': checks}
    (OUTPUT / 'native-tests.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if status == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
