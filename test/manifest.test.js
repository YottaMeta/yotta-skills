'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const manifest = require('../lib/manifest');

const skill = {
  slug: 'yotta-demo',
  name: '元示例',
  pkg: '@yottameta/yotta-demo',
  version: '1.2.3',
};

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ys-manifest-'));
}

function writePackage(dir, version, skillName) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: skill.pkg,
    version,
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), [
    '---',
    'name: ' + (skillName || skill.slug),
    'version: ' + version,
    '---',
    '',
    '# demo',
    '',
  ].join('\n'), 'utf8');
}

test('loadManifest uses package manifest when present', () => {
  const dir = tmp();
  writePackage(dir, '1.2.3');
  fs.writeFileSync(path.join(dir, 'skill-manifest.json'), JSON.stringify({
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/yotta-demo',
    version: '1.2.3',
    trust: 'yottameta',
    install: { idempotent: true },
    permissions: { filesystem: 'user-skills-dir', network: 'registry' },
  }, null, 2), 'utf8');
  const result = manifest.loadManifest({ pkgDir: dir, skill });
  assert.strictEqual(result.source, 'package');
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.manifest.slug, 'yotta-demo');
});

test('loadManifest falls back to family defaults', () => {
  const dir = tmp();
  writePackage(dir, '1.2.3');
  const result = manifest.loadManifest({ pkgDir: dir, skill });
  assert.strictEqual(result.source, 'family-default');
  assert.strictEqual(result.manifest.package, skill.pkg);
  assert.strictEqual(result.manifest.install.idempotent, true);
  assert.strictEqual(result.manifest.auto_apply.mode, 'route');
});

test('validateManifest rejects package identity mismatch', () => {
  const dir = tmp();
  writePackage(dir, '1.2.3');
  const result = manifest.validateManifest({
    manifestVersion: 1,
    slug: 'yotta-demo',
    name: '元示例',
    package: '@yottameta/other',
    version: '1.2.3',
    trust: 'yottameta',
    install: { idempotent: true },
    permissions: { filesystem: 'user-skills-dir', network: 'registry' },
  }, { pkgDir: dir, skill });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('package')));
});

test('isSafeRelativePath rejects absolute and traversal paths', () => {
  assert.strictEqual(manifest.isSafeRelativePath('scripts/lifecycle/setup.js'), true);
  assert.strictEqual(manifest.isSafeRelativePath('../setup.js'), false);
  assert.strictEqual(manifest.isSafeRelativePath('/tmp/setup.js'), false);
  assert.strictEqual(manifest.isSafeRelativePath('C:\\tmp\\setup.js'), false);
  assert.strictEqual(manifest.isSafeRelativePath('scripts\\..\\setup.js'), false);
});
