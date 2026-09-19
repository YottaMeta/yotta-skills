'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gate = require('../lib/verify-gate');
const trusted = require('../lib/trusted-verifier');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 造一个「身份齐备」的元信包（用于正向 / 反向用例）。 */
function makeVerifierPackage(base, overrides) {
  const o = overrides || {};
  const dir = path.join(base, 'yotta-verify');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  const version = o.version || '0.3.2';
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + (o.skillName || 'yotta-verify') + '\nversion: ' + version + '\n---\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'skill-manifest.json'), JSON.stringify({
    manifestVersion: 1,
    slug: o.slug || 'yotta-verify',
    name: '元信',
    package: o.pkg || '@yottameta/yotta-verify',
    version: o.manifestVersion || version,
    trust: o.trust || 'yottameta',
  }, null, 2), 'utf8');
  const engine = path.join(dir, 'scripts', 'yotta_verify.py');
  fs.writeFileSync(engine, '# engine ' + (o.engineBody || 'ok') + '\n', 'utf8');
  return { dir: dir, engine: engine };
}

function recordFor(engine) {
  return {
    slug: 'yotta-verify',
    package: '@yottameta/yotta-verify',
    version: '0.3.2',
    path: engine,
    sha256: trusted.sha256File(engine),
    recordedAt: '2026-09-19T00:00:00.000Z',
  };
}

test('注册表身份不再构成信任（T07 回归：伪造 yotta-verify 目录不被选中）', () => {
  const dest = tmp('ys-tv-dest-');
  const spoof = makeVerifierPackage(tmp('ys-tv-spoof-'));
  const registry = { skills: { 'yotta-verify': { source_dirs: [spoof.dir] } } };
  assert.strictEqual(gate.findVerifier({ dest, opts: {}, registry }), null);
  assert.strictEqual(gate.findVerifier({ dest, opts: {}, registry, trustedVerifier: null }), null);
});

test('显式 --verify / 环境变量仍被尊重（用户显式指定）', () => {
  const dest = tmp('ys-tv-dest-');
  const spoof = makeVerifierPackage(tmp('ys-tv-spoof-'));
  assert.strictEqual(gate.findVerifier({ dest, opts: { verify: spoof.engine } }), spoof.engine);
});

test('受信安装记录 + 摘要一致才被采用', () => {
  const dest = tmp('ys-tv-dest-');
  const pkg = makeVerifierPackage(tmp('ys-tv-pkg-'));
  const record = recordFor(pkg.engine);
  assert.strictEqual(gate.findVerifier({ dest, opts: {}, trustedVerifier: record }), pkg.engine);
});

test('摘要不一致 → 拒绝（fail-closed）', () => {
  const dest = tmp('ys-tv-dest-');
  const pkg = makeVerifierPackage(tmp('ys-tv-pkg-'));
  const record = recordFor(pkg.engine);
  record.sha256 = 'deadbeef'.repeat(8);
  assert.strictEqual(gate.findVerifier({ dest, opts: {}, trustedVerifier: record }), null);
});

test('身份不符 → 拒绝（即使摘要一致）', () => {
  const dest = tmp('ys-tv-dest-');
  const pkg = makeVerifierPackage(tmp('ys-tv-pkg-'), { slug: 'yotta-evil', pkg: '@evil/yotta-verify' });
  const record = recordFor(pkg.engine);
  assert.strictEqual(gate.findVerifier({ dest, opts: {}, trustedVerifier: record }), null);
});

test('版本与 manifest 不一致 → 拒绝', () => {
  const dest = tmp('ys-tv-dest-');
  const pkg = makeVerifierPackage(tmp('ys-tv-pkg-'), { manifestVersion: '9.9.9' });
  const record = recordFor(pkg.engine);
  assert.strictEqual(gate.findVerifier({ dest, opts: {}, trustedVerifier: record }), null);
});

test('目标目录里的同名引擎未经身份 + 记录校验不被采用', () => {
  const dest = tmp('ys-tv-dest-');
  const engine = path.join(dest, 'yotta-verify', 'scripts', 'yotta_verify.py');
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.writeFileSync(engine, '# bare engine\n', 'utf8');
  assert.strictEqual(gate.findVerifier({ dest, opts: {} }), null);
});

test('安装记录读写往返（记录落在注册表同目录）', () => {
  const base = tmp('ys-tv-reg-');
  const registryFile = path.join(base, 'registry.json');
  const pkg = makeVerifierPackage(tmp('ys-tv-pkg-'));
  const record = recordFor(pkg.engine);
  const saved = trusted.saveRecord(record, registryFile);
  assert.strictEqual(saved, path.join(base, 'trusted-verifier.json'));
  const loaded = trusted.loadRecord(registryFile);
  assert.strictEqual(loaded.path, record.path);
  assert.strictEqual(loaded.sha256, record.sha256);
});
