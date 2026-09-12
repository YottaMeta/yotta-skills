'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../lib/install-evidence');

test('appendEvidence writes one JSON line under .yottaskills', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-evidence-'));
  const file = evidence.appendEvidence({
    event: 'before_install',
    skill: 'yotta-demo',
    decision: 'allow',
  }, { homeDir: home });
  assert.strictEqual(file, path.join(home, '.yottaskills', 'install-log.jsonl'));
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).decision, 'allow');
});

test('appendEvidence preserves prior records', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-evidence-'));
  evidence.appendEvidence({ event: 'first' }, { homeDir: home });
  evidence.appendEvidence({ event: 'second' }, { homeDir: home });
  const lines = fs.readFileSync(evidence.evidencePath({ homeDir: home }), 'utf8').trim().split(/\r?\n/);
  assert.deepStrictEqual(lines.map((line) => JSON.parse(line).event), ['first', 'second']);
});
