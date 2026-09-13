'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lifecycle = require('../lib/install-lifecycle');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeScript(source) {
  const file = path.join(tmpdir('ys-lifecycle-'), 'phase.js');
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

test('lifecycle runner accepts a structured successful result', () => {
  const script = writeScript(
    "process.stdout.write(JSON.stringify({ok:true, checks:[{id:'demo',ok:true}]}));\n",
  );
  const result = lifecycle.runLifecycleScript(script, ['--skill-dir', '/tmp/skill']);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.result.ok, true);
  assert.strictEqual(result.result.checks[0].id, 'demo');
  assert.strictEqual(result.exitCode, 0);
});

test('lifecycle runner reports a structured failed result', () => {
  const script = writeScript(
    "process.stdout.write(JSON.stringify({ok:false,error:'boom',fixes:['retry']}));\n",
  );
  const result = lifecycle.runLifecycleScript(script, []);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /boom/);
  assert.deepStrictEqual(result.result.fixes, ['retry']);
});

test('lifecycle runner rejects missing and non-JSON scripts', () => {
  const missing = lifecycle.runLifecycleScript(path.join(tmpdir('ys-lifecycle-'), 'missing.js'), []);
  assert.strictEqual(missing.ok, false);
  assert.match(missing.error, /不存在/);

  const bad = writeScript("process.stdout.write('not-json');\n");
  const invalid = lifecycle.runLifecycleScript(bad, []);
  assert.strictEqual(invalid.ok, false);
  assert.match(invalid.error, /JSON/);
});

test('runPhase skips an undeclared phase', () => {
  const packageDir = tmpdir('ys-lifecycle-pkg-');
  const result = lifecycle.runPhase(packageDir, { install: { idempotent: true } }, 'setup', {});
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
});

test('runPhase rejects unsafe script paths before execution', () => {
  const packageDir = tmpdir('ys-lifecycle-pkg-');
  const result = lifecycle.runPhase(
    packageDir,
    { install: { idempotent: true, setup: '../escape.js' } },
    'setup',
    {},
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /不安全/);
});

test('runPhase resolves a package-local script and passes stable arguments', () => {
  const packageDir = tmpdir('ys-lifecycle-pkg-');
  const scriptDir = path.join(packageDir, 'scripts', 'lifecycle');
  fs.mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, 'setup.js');
  fs.writeFileSync(script, [
    "const args = process.argv.slice(2);",
    "process.stdout.write(JSON.stringify({ok:true,args:args}));",
  ].join('\n'), 'utf8');

  const result = lifecycle.runPhase(
    packageDir,
    { install: { idempotent: true, setup: 'scripts/lifecycle/setup.js' } },
    'setup',
    { skillDir: '/skills/demo', packageDir: '/extract/demo', dest: '/skills' },
  );

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.result.args, [
    '--skill-dir', '/skills/demo',
    '--package-dir', '/extract/demo',
    '--dest', '/skills',
    '--json',
  ]);
});
