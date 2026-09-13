'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const health = require('../lib/install-health');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(target, options) {
  const opts = options || {};
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'SKILL.md'),
    '---\nname: ' + (opts.name || 'yotta-demo') + '\nversion: ' + (opts.version || '1.0.0') + '\n---\n',
    'utf8',
  );
  if (opts.manifest !== undefined) {
    fs.writeFileSync(
      path.join(target, 'skill-manifest.json'),
      JSON.stringify(opts.manifest, null, 2),
      'utf8',
    );
  }
}

test('doctor accepts a healthy installed skill', () => {
  const target = path.join(tmpdir('ys-health-'), 'yotta-demo');
  writeSkill(target, {});
  const result = health.checkInstalledSkill({
    slug: 'yotta-demo',
    target,
    expectedVersion: '1.0.0',
    expectedPackage: '@yottameta/yotta-demo',
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.version, '1.0.0');
  assert.ok(result.checks.every((check) => check.ok || check.severity === 'warning'));
});

test('doctor detects a damaged or version-mismatched SKILL.md', () => {
  const missing = health.checkInstalledSkill({
    slug: 'yotta-demo',
    target: path.join(tmpdir('ys-health-'), 'missing'),
    expectedVersion: '1.0.0',
  });
  assert.strictEqual(missing.ok, false);
  assert.ok(missing.errors.some((item) => /目录不存在/.test(item)));

  const target = path.join(tmpdir('ys-health-'), 'yotta-demo');
  writeSkill(target, { version: '0.9.0' });
  const mismatch = health.checkInstalledSkill({
    slug: 'yotta-demo',
    target,
    expectedVersion: '1.0.0',
  });
  assert.strictEqual(mismatch.ok, false);
  assert.ok(mismatch.errors.some((item) => /版本不一致/.test(item)));
});

test('doctor detects a manifest identity mismatch without package.json', () => {
  const target = path.join(tmpdir('ys-health-'), 'yotta-demo');
  writeSkill(target, {
    manifest: {
      manifestVersion: 1,
      slug: 'yotta-other',
      name: '其它技能',
      package: '@yottameta/yotta-other',
      version: '1.0.0',
      trust: 'yottameta',
      install: { idempotent: true },
      permissions: { filesystem: 'user-skills-dir', network: 'none' },
    },
  });
  const result = health.checkInstalledSkill({
    slug: 'yotta-demo',
    target,
    expectedVersion: '1.0.0',
    expectedPackage: '@yottameta/yotta-demo',
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((item) => /slug 与清单不一致/.test(item)));
});

test('doctor reports a registry version mismatch as a warning with a fix', () => {
  const target = path.join(tmpdir('ys-health-'), 'yotta-demo');
  writeSkill(target, {});
  const result = health.checkInstalledSkill({
    slug: 'yotta-demo',
    target,
    expectedVersion: '1.0.0',
    registry: { skills: { 'yotta-demo': { version: '0.9.0' } } },
  });
  assert.strictEqual(result.ok, true);
  assert.ok(result.warnings.some((item) => /注册表版本/.test(item)));
  assert.ok(result.fixes.some((item) => /--reindex/.test(item)));
});

test('doctor rejects a non-family manifest trust level', () => {
  const target = path.join(tmpdir('ys-health-'), 'yotta-demo');
  writeSkill(target, {
    manifest: {
      manifestVersion: 1,
      slug: 'yotta-demo',
      name: '元示例',
      package: '@yottameta/yotta-demo',
      version: '1.0.0',
      trust: 'unknown',
      install: { idempotent: true },
      permissions: { filesystem: 'user-skills-dir', network: 'none' },
    },
  });
  const result = health.checkInstalledSkill({
    slug: 'yotta-demo',
    target,
    expectedVersion: '1.0.0',
    expectedPackage: '@yottameta/yotta-demo',
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((item) => /trust/.test(item)));
});
