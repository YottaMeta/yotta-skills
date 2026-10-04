'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInstaller, renameWithRetry, isSafeTarEntry } = require('../lib/install-pipeline');
const { COPY_SKIP, copyDir: copyTree } = require('../lib/copy-tree');

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
  return { installer, dest, home, pkgDir };
}

test('safe pipeline installs a new package', () => {
  const { installer, dest } = fixture({});
  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'ok');
  assert.ok(fs.existsSync(path.join(dest, skill.slug, 'SKILL.md')));
});

test('staged swap keeps nested package.json / bin payload (copy-tree top-level skip)', () => {
  const { installer, dest, pkgDir } = fixture({
    copyDir: (src, dst) => copyTree(src, dst, COPY_SKIP, true),
  });
  fs.mkdirSync(path.join(pkgDir, 'template', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'template', 'package.json'), '{"name":"{{skill_name}}"}', 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'template', 'bin', 'install.js'), '// nested installer', 'utf8');

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'ok');
  const target = path.join(dest, skill.slug);
  // 顶层开发件跳过
  assert.equal(fs.existsSync(path.join(target, 'package.json')), false);
  // 嵌套同名载荷保留（本批修复回归点）
  assert.equal(fs.readFileSync(path.join(target, 'template', 'package.json'), 'utf8'), '{"name":"{{skill_name}}"}');
  assert.equal(fs.readFileSync(path.join(target, 'template', 'bin', 'install.js'), 'utf8'), '// nested installer');
  assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
});

test('hub-scope install keeps declared runtimePayload top-level files (bin)', () => {
  const { installer, dest, pkgDir } = fixture({
    copyDir: (src, dst, options) => {
      const skip = new Set(COPY_SKIP);
      for (const name of (options && options.keep) || []) skip.delete(name);
      copyTree(src, dst, skip, true);
    },
  });
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'bin', 'cli.js'), '// cli', 'utf8');
  const runtimeSkill = { ...skill, runtimePayload: ['bin'] };

  const normal = installer(runtimeSkill, dest, {});
  assert.strictEqual(normal.status, 'ok');
  assert.equal(fs.existsSync(path.join(dest, skill.slug, 'bin', 'cli.js')), false,
    'normal host install stays thin (no bin)');

  const hubDest = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-pipe-hub-'));
  const hub = installer(runtimeSkill, hubDest, { hubScope: true });
  assert.strictEqual(hub.status, 'ok');
  assert.equal(fs.readFileSync(path.join(hubDest, skill.slug, 'bin', 'cli.js'), 'utf8'), '// cli',
    'hub install keeps declared runtimePayload');
});

test('install evidence carries scan policy review details and context', () => {
  const evidence = [];
  let seenContext = null;
  const { installer, dest } = fixture({
    appendEvidence: (entry) => {
      evidence.push(entry);
      return '/tmp/install-log.jsonl';
    },
    scanTarget: (engine, dir, context) => {
      seenContext = context;
      return {
        ok: true,
        verdict: 'SAFE TO INSTALL',
        counts: { critical: 0, high: 0, medium: 0, low: 2, info: 0 },
        policy: {
          applied: true,
          reason: 'applied',
          excluded: 10,
          excludedFindings: [],
          version: '1.0.0',
          treeHash: 'sha256:test',
        },
      };
    },
  });
  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(seenContext, { slug: skill.slug, version: '1.0.0', opts: {} });
  const before = evidence.find((entry) => entry.event === 'before_install' && entry.skill === skill.slug);
  assert.ok(before, '缺少 before_install 证据');
  assert.strictEqual(before.scan_policy.applied, true);
  assert.strictEqual(before.scan_policy.excluded, 10);
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

test('before_install hook blocks scan failure and records hook evidence', () => {
  const hookEvidence = [];
  const { installer, dest } = fixture({
    manifest: {
      manifestVersion: 1,
      slug: 'yotta-demo',
      name: '元示例',
      package: '@yottameta/yotta-demo',
      version: '1.0.0',
      trust: 'yottameta',
      install: { idempotent: true },
      permissions: { filesystem: 'user-skills-dir', network: 'none' },
      hooks: [{
        event: 'before_install',
        require_tool: 'scan_skill',
        on_fail: 'block',
        fallback: 'wrapper',
        evidence: ['audit_log'],
      }],
    },
    scanTarget: () => ({ ok: true, verdict: 'DO NOT INSTALL', counts: { critical: 1 } }),
    appendHookEvidence: (entry) => hookEvidence.push(entry),
  });
  const target = path.join(dest, skill.slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old', 'utf8');

  const result = installer(skill, dest, {});
  assert.strictEqual(result.status, 'fail');
  assert.match(result.note, /before_install|DO NOT INSTALL/);
  assert.strictEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'old');
  assert.strictEqual(hookEvidence.length, 1);
  assert.strictEqual(hookEvidence[0].event, 'before_install');
  assert.strictEqual(hookEvidence[0].result, 'block');
  assert.strictEqual(hookEvidence[0].evidence.audit_log, 'install-log.jsonl');
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

test('dryRun returns a plan without network or disk writes (0.29.0 D1)', () => {
  let packCalls = 0;
  const { installer, dest } = fixture({
    runNpmPack: () => {
      packCalls++;
      return { tarball: '/tmp/demo.tgz', resolved: '1.0.0', spec: skill.pkg + '@1.x' };
    },
    readInstalledVersion: () => '0.9.0',
  });
  const result = installer(skill, dest, { dryRun: true });
  assert.strictEqual(result.status, 'planned');
  assert.strictEqual(result.planned, 'update');
  assert.strictEqual(result.installedVersion, '0.9.0');
  assert.strictEqual(result.version, '1.0.0');
  assert.strictEqual(packCalls, 0, 'dry-run 不得调用 npm pack');
  assert.strictEqual(fs.existsSync(path.join(dest, skill.slug)), false, 'dry-run 不得写盘');
});

test('dryRun marks latest-version skills as unresolved preview (0.29.0 D1)', () => {
  const latestSkill = { ...skill, version: 'latest' };
  const { installer, dest } = fixture({});
  const result = installer(latestSkill, dest, { dryRun: true });
  assert.strictEqual(result.status, 'planned');
  assert.strictEqual(result.version, 'latest');
  assert.strictEqual(result.latestUnresolved, true);
  assert.match(result.note, /预览不解析/);
});
