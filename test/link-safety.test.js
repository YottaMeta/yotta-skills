'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const linkSafety = require('../lib/link-safety');
const copyTree = require('../lib/copy-tree');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-link-safety-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function linkDir(t, real, link) {
  try {
    fs.symlinkSync(real, link, 'junction');
    return true;
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('当前主机不能创建目录 junction');
    }
    try {
      fs.symlinkSync(real, link, 'dir');
      return true;
    } catch (_) {
      t.skip('当前主机不能创建目录链接');
      return false;
    }
  }
}

test('normal directory is used as-is', (t) => {
  const root = tempDir(t);
  const target = path.join(root, 'yotta-alpha');
  fs.mkdirSync(target);
  const resolved = linkSafety.resolveInstallTarget(target, 'yotta-alpha');
  assert.equal(resolved.viaLink, false);
  assert.equal(resolved.target, target);
});

test('missing target is used as-is', (t) => {
  const root = tempDir(t);
  const target = path.join(root, 'yotta-alpha');
  const resolved = linkSafety.resolveInstallTarget(target, 'yotta-alpha');
  assert.equal(resolved.viaLink, false);
  assert.equal(resolved.target, target);
});

test('arbitrary directory link is rejected', (t) => {
  const root = tempDir(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const link = path.join(root, 'skills', 'yotta-alpha');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  linkDir(t, outside, link);
  assert.throws(
    () => linkSafety.resolveInstallTarget(link, 'yotta-alpha'),
    (error) => error instanceof linkSafety.TargetError && /符号链接|junction/.test(error.message),
  );
});

test('managed Hub link resolves to the real target', (t) => {
  const root = tempDir(t);
  const hub = path.join(root, 'hub');
  const real = path.join(hub, 'yotta-alpha');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(hub, '.yotta-hub.json'), '{}', 'utf8');
  const link = path.join(root, 'skills', 'yotta-alpha');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  linkDir(t, real, link);
  const resolved = linkSafety.resolveInstallTarget(link, 'yotta-alpha');
  assert.equal(resolved.viaLink, true);
  assert.equal(resolved.target, fs.realpathSync(real));
});

test('nested link is rejected', (t) => {
  const root = tempDir(t);
  const outside = path.join(root, 'outside');
  const target = path.join(root, 'skills', 'yotta-alpha');
  fs.mkdirSync(outside);
  fs.mkdirSync(target, { recursive: true });
  linkDir(t, outside, path.join(target, 'scripts'));
  assert.throws(
    () => linkSafety.resolveInstallTarget(target, 'yotta-alpha'),
    (error) => error instanceof linkSafety.TargetError && /目标目录包含/.test(error.message),
  );
});

test('copy-tree rejects a linked destination path', (t) => {
  const root = tempDir(t);
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(source, 'scripts', 'run.js'), 'ok\n', 'utf8');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(outside);
  linkDir(t, outside, path.join(target, 'scripts'));
  assert.throws(
    () => copyTree.copyDir(source, target, copyTree.COPY_SKIP, false),
    (error) => error instanceof linkSafety.TargetError,
  );
  assert.equal(fs.readdirSync(outside).length, 0);
});
