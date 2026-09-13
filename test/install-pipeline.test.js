'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInstaller, renameWithRetry, isSafeTarEntry } = require('../lib/install-pipeline');

const skill = { slug: 'yotta-demo', name: '元示例', pkg: '@yottameta/yotta-demo', version: '1.0.0' };

function fixture(deps) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-pipe-home-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-pipe-dest-'));
  const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-pipe-pkg-'));
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: skill.pkg, version: '1.0.0' }), 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'SKILL.md'), '---\nname: yotta-demo\nversion: 1.0.0\n---\n', 'utf8');
  if (deps && deps.manifest) {
    fs.writeFileSync(path.join(pkgDir, 'skill-manifest.json'), JSON.stringify(deps.manifest, null, 2), 'utf8');
  }
  const runNpmPack = () => ({ tarball: '/tmp/demo.tgz', resolved: '1.0.0', spec: skill.pkg + '@1.x' });
  const extractTarball = () => ({ pkgDir });
  const appendEvidence = () => '/tmp/install-log.jsonl';
  const copyDir = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(src, 'SKILL.md'), path.join(dst, 'SKILL.md'));
    const manifestFile = path.join(src, 'skill-manifest.json');
    if (fs.existsSync(manifestFile)) fs.copyFileSync(manifestFile, path.join(dst, 'skill-manifest.json'));
  };
  const installer = createInstaller({
    runNpmPack,
    extractTarball,
    copyDir,
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

test('pipeline runs setup and doctor and keeps a validated snapshot', () => {
  const phases = [];
  const manifest = {
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/yotta-demo',
    version: '1.0.0',
    trust: 'yottameta',
    install: {
      idempotent: true,
      setup: 'scripts/lifecycle/setup.js',
      doctor: 'scripts/lifecycle/doctor.js',
    },
    permissions: { filesystem: 'user-skills-dir', network: 'none' },
  };
  const { installer, dest } = fixture({
    manifest,
    runPhase: (packageDir, loaded, phase) => {
      phases.push(phase);
      return { ok: true, skipped: false, result: { ok: true }, error: null };
    },
  });
  const target = path.join(dest, skill.slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old', 'utf8');

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'ok', result.note);
  assert.deepStrictEqual(phases, ['setup', 'doctor']);
  assert.ok(result.snapshot, '应返回快照路径');
  assert.ok(fs.existsSync(path.join(result.snapshot, 'SKILL.md')));
  assert.ok(fs.existsSync(result.snapshot + '.meta.json'));
});

test('setup failure restores the old target and keeps the snapshot', () => {
  const evidence = [];
  const manifest = {
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/yotta-demo',
    version: '1.0.0',
    trust: 'yottameta',
    install: { idempotent: true, setup: 'scripts/lifecycle/setup.js' },
    permissions: { filesystem: 'user-skills-dir', network: 'none' },
  };
  const { installer, dest } = fixture({
    manifest,
    appendEvidence: (entry) => { evidence.push(entry); return '/tmp/install-log.jsonl'; },
    runPhase: (packageDir, loaded, phase) => {
      if (phase === 'setup') return { ok: false, skipped: false, error: 'setup boom', result: null };
      return { ok: true, skipped: true, error: null, result: null };
    },
  });
  const target = path.join(dest, skill.slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old', 'utf8');

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.match(result.note, /setup boom/);
  assert.strictEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'old');
  assert.ok(result.snapshot && fs.existsSync(result.snapshot));
  assert.ok(evidence.some((entry) => entry.event === 'rollback'));
});

test('doctor failure restores the old target', () => {
  const manifest = {
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/yotta-demo',
    version: '1.0.0',
    trust: 'yottameta',
    install: {
      idempotent: true,
      setup: 'scripts/lifecycle/setup.js',
      doctor: 'scripts/lifecycle/doctor.js',
    },
    permissions: { filesystem: 'user-skills-dir', network: 'none' },
  };
  const { installer, dest } = fixture({
    manifest,
    runPhase: (packageDir, loaded, phase) => {
      if (phase === 'doctor') return { ok: false, skipped: false, error: 'doctor boom', result: null };
      return { ok: true, skipped: false, result: { ok: true }, error: null };
    },
  });
  const target = path.join(dest, skill.slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old', 'utf8');

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.match(result.note, /doctor boom/);
  assert.strictEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'old');
});

test('fresh install setup failure removes the failed new target', () => {
  const manifest = {
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/yotta-demo',
    version: '1.0.0',
    trust: 'yottameta',
    install: { idempotent: true, setup: 'scripts/lifecycle/setup.js' },
    permissions: { filesystem: 'user-skills-dir', network: 'none' },
  };
  const { installer, dest } = fixture({
    manifest,
    runPhase: () => ({ ok: false, skipped: false, error: 'setup boom', result: null }),
  });

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.ok(!fs.existsSync(path.join(dest, skill.slug)));
});

test('custom rollback failure keeps the snapshot and reports the failure', () => {
  const evidence = [];
  const manifest = {
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/yotta-demo',
    version: '1.0.0',
    trust: 'yottameta',
    install: {
      idempotent: true,
      setup: 'scripts/lifecycle/setup.js',
      rollback: 'scripts/lifecycle/rollback.js',
    },
    permissions: { filesystem: 'user-skills-dir', network: 'none' },
  };
  const { installer, dest } = fixture({
    manifest,
    appendEvidence: (entry) => { evidence.push(entry); return '/tmp/install-log.jsonl'; },
    runPhase: (packageDir, loaded, phase) => {
      if (phase === 'setup') return { ok: false, skipped: false, error: 'setup boom', result: null };
      if (phase === 'rollback') return { ok: false, skipped: false, error: 'rollback boom', result: null };
      return { ok: true, skipped: true, error: null, result: null };
    },
  });
  const target = path.join(dest, skill.slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old', 'utf8');

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.match(result.note, /rollback boom/);
  assert.strictEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'old');
  assert.ok(result.snapshot && fs.existsSync(result.snapshot));
  assert.ok(evidence.some((entry) => entry.event === 'rollback' && entry.decision === 'fail'));
});

test('pipeline rejects an untrusted manifest before running lifecycle scripts', () => {
  let lifecycleCalled = false;
  const manifest = {
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/yotta-demo',
    version: '1.0.0',
    trust: 'unknown',
    install: { idempotent: true, setup: 'scripts/lifecycle/setup.js' },
    permissions: { filesystem: 'user-skills-dir', network: 'none' },
  };
  const { installer, dest } = fixture({
    manifest,
    runPhase: () => { lifecycleCalled = true; return { ok: true, skipped: false }; },
  });

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.match(result.note, /trust/);
  assert.strictEqual(lifecycleCalled, false);
});

test('renameWithRetry retries transient EPERM on Windows', () => {
  let attempts = 0;
  const result = renameWithRetry('from', 'to', {
    rename() {
      attempts++;
      if (attempts < 3) {
        const error = new Error('locked');
        error.code = 'EPERM';
        throw error;
      }
      return 'ok';
    },
    sleep() {},
  });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(attempts, 3);
});

test('isSafeTarEntry rejects traversal, absolute and non-package entries', () => {
  assert.strictEqual(isSafeTarEntry('package/SKILL.md'), true);
  assert.strictEqual(isSafeTarEntry('package'), true);
  assert.strictEqual(isSafeTarEntry('../evil'), false);
  assert.strictEqual(isSafeTarEntry('package/../../evil'), false);
  assert.strictEqual(isSafeTarEntry('/tmp/evil'), false);
  assert.strictEqual(isSafeTarEntry('C:\\tmp\\evil'), false);
  assert.strictEqual(isSafeTarEntry('other/file'), false);
});
