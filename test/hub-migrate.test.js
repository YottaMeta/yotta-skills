'use strict';
/**
 * 0.29.2 U4：Hub 迁移两段式（stageHubCopy / relinkAndRetireOldHub）fail-closed 语义。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const migrateLib = require('../lib/hub-migrate');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  const target = path.join(dir, slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
  return target;
}

function linkDir(target, linkPath) {
  fs.symlinkSync(path.resolve(target), linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

test('stageHubCopy copies + verifies, and refuses non-empty or nested targets', () => {
  const home = tmp('ys-mig-stage-');
  try {
    const from = path.join(home, 'old');
    writeSkill(from, 'yotta-a', '1.0.0');
    fs.writeFileSync(path.join(from, 'marker.txt'), 'x', 'utf8');
    const to = path.join(home, 'new');

    const staged = migrateLib.stageHubCopy({ from, to });
    assert.strictEqual(staged.ok, true, staged.error);
    assert.ok(fs.existsSync(path.join(to, 'yotta-a', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(to, 'marker.txt')));

    const nonEmpty = path.join(home, 'busy');
    fs.mkdirSync(nonEmpty, { recursive: true });
    fs.writeFileSync(path.join(nonEmpty, 'keep.txt'), 'x', 'utf8');
    const refused = migrateLib.stageHubCopy({ from, to: nonEmpty });
    assert.strictEqual(refused.ok, false);
    assert.match(refused.error, /非空/);
    assert.ok(fs.existsSync(path.join(nonEmpty, 'keep.txt')), 'non-empty target must stay untouched');

    const nested = migrateLib.stageHubCopy({ from, to: path.join(from, 'inner') });
    assert.strictEqual(nested.ok, false);
    assert.match(nested.error, /嵌套/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('relinkAndRetireOldHub retargets host links and trashes the old hub on success', () => {
  const home = tmp('ys-mig-relink-');
  try {
    const from = path.join(home, 'old');
    const to = path.join(home, 'new');
    const skill = writeSkill(from, 'yotta-a', '1.0.0');
    const staged = migrateLib.stageHubCopy({ from, to });
    assert.strictEqual(staged.ok, true, staged.error);

    const hostDir = path.join(home, 'host-skills');
    fs.mkdirSync(hostDir, { recursive: true });
    const link = path.join(hostDir, 'yotta-a');
    linkDir(skill, link);

    const finish = migrateLib.relinkAndRetireOldHub({
      from,
      to,
      targets: [{ dir: hostDir, label: 'test host' }],
      env: { YOTTA_SKILLS_TRASH: path.join(home, 'trash') },
    });
    assert.strictEqual(finish.ok, true, JSON.stringify(finish));
    assert.strictEqual(finish.incomplete, 0);
    assert.strictEqual(
      fs.realpathSync.native(link).toLowerCase(),
      fs.realpathSync.native(path.join(to, 'yotta-a')).toLowerCase());
    assert.ok(finish.trashedTo && fs.existsSync(finish.trashedTo), 'old hub must be in trash');
    assert.ok(!fs.existsSync(from), 'old hub must be gone after successful migration');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('relinkAndRetireOldHub keeps the old hub when a target cannot be relinked', () => {
  const home = tmp('ys-mig-keep-');
  try {
    const from = path.join(home, 'old');
    const to = path.join(home, 'new');
    writeSkill(from, 'yotta-a', '1.0.0');
    assert.strictEqual(migrateLib.stageHubCopy({ from, to }).ok, true);

    const hostDir = path.join(home, 'host-skills');
    fs.mkdirSync(hostDir, { recursive: true });
    fs.writeFileSync(path.join(hostDir, 'yotta-a'), 'plain file blocks relink\n', 'utf8');

    const finish = migrateLib.relinkAndRetireOldHub({
      from,
      to,
      targets: [{ dir: hostDir, label: 'blocked host' }],
      env: { YOTTA_SKILLS_TRASH: path.join(home, 'trash') },
    });
    assert.strictEqual(finish.ok, false);
    assert.ok(finish.incomplete > 0);
    assert.strictEqual(finish.trashedTo, null);
    assert.ok(fs.existsSync(from), 'old hub must be kept when relink is incomplete');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
