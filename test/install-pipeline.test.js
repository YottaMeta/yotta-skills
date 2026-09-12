'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInstaller } = require('../lib/install-pipeline');

const skill = { slug: 'yotta-demo', name: '元示例', pkg: '@yottameta/yotta-demo', version: '1.0.0' };

function fixture(deps) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-pipe-home-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-pipe-dest-'));
  const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-pipe-pkg-'));
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: skill.pkg, version: '1.0.0' }), 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'SKILL.md'), '---\nname: yotta-demo\nversion: 1.0.0\n---\n', 'utf8');
  const runNpmPack = () => ({ tarball: '/tmp/demo.tgz', resolved: '1.0.0', spec: skill.pkg + '@1.x' });
  const extractTarball = () => ({ pkgDir });
  const appendEvidence = () => '/tmp/install-log.jsonl';
  const installer = createInstaller({
    runNpmPack,
    extractTarball,
    copyDir: (src, dst) => {
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(path.join(src, 'SKILL.md'), path.join(dst, 'SKILL.md'));
    },
    readInstalledVersion: () => null,
    ensureGate: () => ({ ok: true, engine: '/tmp/verify.py', mode: 'installed' }),
    scanTarget: () => ({ ok: true, verdict: 'SAFE TO INSTALL', counts: {} }),
    appendEvidence,
    homeDir: home,
    ...deps,
  });
  return { installer, dest, home };
}

test('safe pipeline installs a new package', () => {
  const { installer, dest } = fixture({});
  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'ok');
  assert.ok(fs.existsSync(path.join(dest, skill.slug, 'SKILL.md')));
});

test('safe pipeline blocks DO NOT INSTALL without touching target', () => {
  const { installer, dest } = fixture({
    scanTarget: () => ({ ok: true, verdict: 'DO NOT INSTALL', counts: { critical: 1 } }),
  });
  const target = path.join(dest, skill.slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old', 'utf8');
  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.strictEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'old');
});

test('safe pipeline preserves target when staged copy fails', () => {
  const { installer, dest } = fixture({
    copyDir: (src, dst) => {
      fs.mkdirSync(dst, { recursive: true });
      throw new Error('simulated copy failure');
    },
  });
  const target = path.join(dest, skill.slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old', 'utf8');
  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.strictEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'old');
});

test('safe pipeline marks skip-scan as explicit-unverified', () => {
  const { installer, dest } = fixture({});
  const result = installer(skill, dest, { skipScan: true });
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.gate.mode, 'explicit-unverified');
});
