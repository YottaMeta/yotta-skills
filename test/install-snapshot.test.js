'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const snapshotLib = require('../lib/install-snapshot');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTree(root, version) {
  fs.mkdirSync(path.join(root, 'references'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SKILL.md'),
    '---\nname: yotta-demo\nversion: ' + version + '\n---\n',
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'references', 'notes.md'), version + '\n', 'utf8');
}

test('createSnapshot copies the tree and writes integrity metadata', () => {
  const home = tmpdir('ys-snapshot-home-');
  const target = path.join(tmpdir('ys-snapshot-target-'), 'yotta-demo');
  writeTree(target, '1.0.0');

  const result = snapshotLib.createSnapshot(target, { homeDir: home, slug: 'yotta-demo', version: '1.0.0' });
  assert.ok(fs.existsSync(result.path));
  assert.ok(fs.existsSync(path.join(result.path, 'SKILL.md')));
  assert.strictEqual(result.version, '1.0.0');
  assert.strictEqual(result.files, 2);

  const metaFile = result.path + '.meta.json';
  assert.ok(fs.existsSync(metaFile));
  const metadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  assert.strictEqual(metadata.digest, result.digest);

  const validation = snapshotLib.validateSnapshot(result.path);
  assert.strictEqual(validation.ok, true);
  assert.strictEqual(validation.version, '1.0.0');
  assert.strictEqual(validation.legacy, false);
});

test('validateSnapshot rejects a tampered snapshot', () => {
  const home = tmpdir('ys-snapshot-home-');
  const target = path.join(tmpdir('ys-snapshot-target-'), 'yotta-demo');
  writeTree(target, '1.0.0');
  const result = snapshotLib.createSnapshot(target, { homeDir: home, slug: 'yotta-demo', version: '1.0.0' });

  fs.appendFileSync(path.join(result.path, 'references', 'notes.md'), 'tampered\n', 'utf8');
  const validation = snapshotLib.validateSnapshot(result.path);
  assert.strictEqual(validation.ok, false);
  assert.match(validation.reason, /摘要不一致/);
});

test('validateSnapshot keeps legacy snapshots readable', () => {
  const home = tmpdir('ys-snapshot-home-');
  const slugRoot = snapshotLib.snapshotRoot(home, 'yotta-demo');
  const legacy = path.join(slugRoot, 'legacy-snapshot');
  writeTree(legacy, '0.9.0');

  const validation = snapshotLib.validateSnapshot(legacy);
  assert.strictEqual(validation.ok, true);
  assert.strictEqual(validation.version, '0.9.0');
  assert.strictEqual(validation.legacy, true);
});

test('restoreSnapshot replaces the target and preserves the snapshot', () => {
  const home = tmpdir('ys-snapshot-home-');
  const dest = tmpdir('ys-snapshot-dest-');
  const target = path.join(dest, 'yotta-demo');
  writeTree(target, '1.0.0');
  const result = snapshotLib.createSnapshot(target, { homeDir: home, slug: 'yotta-demo', version: '1.0.0' });

  fs.rmSync(target, { recursive: true, force: true });
  writeTree(target, '2.0.0');
  const restored = snapshotLib.restoreSnapshot(result.path, target);

  assert.strictEqual(restored.ok, true);
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /version: 1\.0\.0/);
  assert.strictEqual(fs.readFileSync(path.join(target, 'references', 'notes.md'), 'utf8').trim(), '1.0.0');
  assert.ok(fs.existsSync(path.join(result.path, 'SKILL.md')), '快照本身必须保留');
});

test('restoreSnapshot leaves the target unchanged when staging fails', () => {
  const home = tmpdir('ys-snapshot-home-');
  const dest = tmpdir('ys-snapshot-dest-');
  const target = path.join(dest, 'yotta-demo');
  writeTree(target, '1.0.0');
  const result = snapshotLib.createSnapshot(target, { homeDir: home, slug: 'yotta-demo', version: '1.0.0' });
  fs.rmSync(target, { recursive: true, force: true });
  writeTree(target, '2.0.0');

  const restored = snapshotLib.restoreSnapshot(result.path, target, {
    copyDir() {
      throw new Error('simulated staging failure');
    },
  });
  assert.strictEqual(restored.ok, false);
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /version: 2\.0\.0/);
});

test('listSnapshots sorts newest snapshots first and reports validity', () => {
  const home = tmpdir('ys-snapshot-home-');
  const oldTarget = path.join(tmpdir('ys-snapshot-target-'), 'yotta-demo');
  const newTarget = path.join(tmpdir('ys-snapshot-target-'), 'yotta-demo');
  writeTree(oldTarget, '1.0.0');
  writeTree(newTarget, '2.0.0');
  const oldSnap = snapshotLib.createSnapshot(oldTarget, { homeDir: home, slug: 'yotta-demo', version: '1.0.0' });
  const newSnap = snapshotLib.createSnapshot(newTarget, { homeDir: home, slug: 'yotta-demo', version: '2.0.0' });
  fs.utimesSync(oldSnap.path, new Date('2026-01-01'), new Date('2026-01-01'));
  fs.utimesSync(newSnap.path, new Date('2026-02-01'), new Date('2026-02-01'));

  const list = snapshotLib.listSnapshots(home, 'yotta-demo');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].path, newSnap.path);
  assert.strictEqual(list[0].valid, true);
  assert.strictEqual(list[1].path, oldSnap.path);
});
