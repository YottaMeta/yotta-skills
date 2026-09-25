'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const manifestLib = require('../lib/manifest');

const SKILLS_ROOT = path.join(__dirname, '..', '..');
const MANDATORY = new Set([
  'yotta-present',
  'yotta-verify',
  'yotta-verify-mcp',
  'yotta-guardian',
  'yotta-workflow',
  'yotta-publish-guard',
  'yotta-memory',
  'yotta-skills',
]);

function readVersion(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const m = skill.match(/^version:\s*(\S+)/m);
  return { pkg, version: m ? m[1] : null };
}

test('every family skill directory resolves a manifest contract', () => {
  const dirs = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('yotta-'))
    .map((entry) => entry.name)
    .sort();
  assert.ok(dirs.length > 0, '至少应有一个 yotta-* 技能目录');

  for (const slug of dirs) {
    const dir = path.join(SKILLS_ROOT, slug);
    const { pkg, version } = readVersion(dir);
    const loaded = manifestLib.loadManifest({
      pkgDir: dir,
      skill: {
        slug,
        name: slug,
        pkg: pkg.name,
        version,
      },
    });
    assert.deepStrictEqual(loaded.errors, [], slug + ' manifest 解析失败');
    assert.ok(loaded.manifest, slug + ' 应有 manifest 或家族默认契约');
  }
});

test('all mandatory skills ship package-level hook declarations', () => {
  for (const slug of MANDATORY) {
    const dir = path.join(SKILLS_ROOT, slug);
    const { pkg, version } = readVersion(dir);
    const loaded = manifestLib.loadManifest({
      pkgDir: dir,
      skill: {
        slug,
        name: slug,
        pkg: pkg.name,
        version,
      },
    });
    assert.deepStrictEqual(loaded.errors, [], slug + ' manifest 解析失败');
    assert.strictEqual(loaded.source, 'package', slug + ' 必须提供包内 manifest');
    assert.ok(Array.isArray(loaded.manifest.hooks) && loaded.manifest.hooks.length > 0, slug + ' 必须声明 hook');
  }
});
