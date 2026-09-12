'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gate = require('../lib/verify-gate');

test('findVerifier prefers explicit path and then destination engine', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-gate-'));
  const dest = path.join(home, 'skills');
  const engine = path.join(dest, 'yotta-verify', 'scripts', 'yotta_verify.py');
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.writeFileSync(engine, '# fake\n', 'utf8');
  assert.strictEqual(gate.findVerifier({ dest, opts: {} }), engine);
  assert.strictEqual(gate.findVerifier({ dest, opts: { verify: engine } }), engine);
});

test('parseScanOutput accepts valid JSON and rejects malformed JSON', () => {
  assert.deepStrictEqual(gate.parseScanOutput('{"verdict":"SAFE TO INSTALL","counts":{"high":0}}'), {
    ok: true,
    verdict: 'SAFE TO INSTALL',
    counts: { high: 0 },
    error: null,
  });
  assert.strictEqual(gate.parseScanOutput('not-json').ok, false);
});

test('evaluateVerdict blocks DO NOT INSTALL and warns on caution/review', () => {
  assert.deepStrictEqual(gate.evaluateVerdict('SAFE TO INSTALL'), { decision: 'allow', block: false, warn: false });
  assert.deepStrictEqual(gate.evaluateVerdict('INSTALL WITH CAUTION'), { decision: 'warn', block: false, warn: true });
  assert.deepStrictEqual(gate.evaluateVerdict('REVIEW REQUIRED'), { decision: 'warn', block: false, warn: true });
  assert.deepStrictEqual(gate.evaluateVerdict('DO NOT INSTALL'), { decision: 'block', block: true, warn: true });
});

test('runVerifier passes -B to Python and parses JSON', () => {
  const calls = [];
  const result = gate.runVerifier('/tmp/verify.py', '/tmp/pkg', {
    python: 'python',
    spawnSync(command, args) {
      calls.push([command, args]);
      return { status: 0, stdout: '{"verdict":"SAFE TO INSTALL","counts":{}}', stderr: '' };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(calls[0], ['python', ['-B', '/tmp/verify.py', 'scan', '/tmp/pkg', '--json']]);
});
