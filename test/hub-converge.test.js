'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hub = require('../lib/hub');
const scan = require('../lib/skills-scan');
const registryFetch = require('../lib/registry-fetch');
const hubAdopt = require('../lib/hub-adopt');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version, marker) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n',
    'utf8');
  if (marker) fs.writeFileSync(path.join(dir, 'marker.txt'), marker, 'utf8');
}

function manifestFor(slug) {
  return [{ slug, name: slug, pkg: '@yottameta/' + slug, version: '0.0.0' }];
}

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function exdevError() {
  const error = new Error('EXDEV: cross-device link not permitted');
  error.code = 'EXDEV';
  throw error;
}

test('family link converges old copies into trash and links to hub', () => {
  const root = tmp('ys-converge-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const trashRoot = path.join(root, 'trash');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(targetDir, 'yotta-test'), 'yotta-test', '0.9.0', 'old');
    writeSkill(path.join(targetDir, 'yotta-test__skillhub'), 'yotta-test', '0.9.0', 'old2');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot,
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'linked', JSON.stringify(item));
    assert.strictEqual(item.moved.length, 2);
    assert.ok(fs.lstatSync(path.join(targetDir, 'yotta-test')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(hubDir, 'yotta-test', 'SKILL.md')), 'hub source must stay intact');
    for (const moved of item.moved) {
      assert.ok(moved.to.startsWith(trashRoot), moved.to);
      assert.ok(fs.existsSync(path.join(moved.to, 'SKILL.md')), moved.to);
    }
    assert.ok(!fs.existsSync(path.join(targetDir, 'yotta-test__skillhub')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('family link keeps host copies when the host version is newer than hub', () => {
  const root = tmp('ys-converge-newer-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(targetDir, 'yotta-test'), 'yotta-test', '1.1.0', 'newer');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot: path.join(root, 'trash'),
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'skipped', JSON.stringify(item));
    assert.match(item.note, /高于 Hub/);
    assert.ok(fs.existsSync(path.join(targetDir, 'yotta-test', 'marker.txt')), 'host copy must stay');
    assert.ok(!fs.lstatSync(path.join(targetDir, 'yotta-test')).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(root, 'trash')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('family link dry-run previews convergence without moving anything', () => {
  const root = tmp('ys-converge-dry-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const trashRoot = path.join(root, 'trash');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(targetDir, 'yotta-test'), 'yotta-test', '0.9.0', 'old');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot,
      dryRun: true,
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'would-converge', JSON.stringify(item));
    assert.strictEqual(item.moves.length, 1);
    assert.ok(fs.existsSync(path.join(targetDir, 'yotta-test', 'marker.txt')));
    assert.ok(!fs.existsSync(trashRoot), 'dry-run must not create trash');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('family link converges renamed copies even when the hub link already exists', () => {
  const root = tmp('ys-converge-relink-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const trashRoot = path.join(root, 'trash');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    hub.linkSkills({ hubDir, targetDir, slugs: ['yotta-test'], manifest: manifestFor('yotta-test'), trashRoot });
    writeSkill(path.join(targetDir, 'yotta-test__skillhub'), 'yotta-test', '1.0.0', 'dup');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot,
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'linked', JSON.stringify(item));
    assert.strictEqual(item.moved.length, 1);
    assert.ok(fs.lstatSync(path.join(targetDir, 'yotta-test')).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(targetDir, 'yotta-test__skillhub')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('family link restores moved copies when creating the link fails', () => {
  const root = tmp('ys-converge-restore-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const trashRoot = path.join(root, 'trash');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(targetDir, 'yotta-test'), 'yotta-test', '0.9.0', 'old');
    writeSkill(path.join(targetDir, 'yotta-test__skillhub'), 'yotta-test', '0.9.0', 'old2');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot,
      createLink: () => { throw new Error('boom'); },
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'error', JSON.stringify(item));
    assert.strictEqual(item.restored, true);
    assert.ok(fs.existsSync(path.join(targetDir, 'yotta-test', 'marker.txt')), 'exact copy restored');
    assert.ok(fs.existsSync(path.join(targetDir, 'yotta-test__skillhub', 'marker.txt')), 'renamed copy restored');
    assert.ok(!fs.lstatSync(path.join(targetDir, 'yotta-test')).isSymbolicLink());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cross-volume convergence falls back to verified copy on EXDEV', () => {
  const root = tmp('ys-converge-exdev-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const trashRoot = path.join(root, 'trash');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(targetDir, 'yotta-test'), 'yotta-test', '0.9.0', 'old');
    writeSkill(path.join(targetDir, 'yotta-test__skillhub'), 'yotta-test', '0.9.0', 'old2');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot,
      renameEntry: exdevError,
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'linked', JSON.stringify(item));
    assert.strictEqual(item.moved.length, 2);
    assert.ok(item.moved.every((moved) => moved.method === 'copy'), JSON.stringify(item.moved));
    assert.match(item.note, /跨卷复制/);
    assert.ok(fs.lstatSync(path.join(targetDir, 'yotta-test')).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(targetDir, 'yotta-test__skillhub')));
    const exact = item.moved.find((moved) => moved.name === 'yotta-test');
    const renamed = item.moved.find((moved) => moved.name === 'yotta-test__skillhub');
    assert.strictEqual(fs.readFileSync(path.join(exact.to, 'marker.txt'), 'utf8'), 'old');
    assert.strictEqual(fs.readFileSync(path.join(renamed.to, 'marker.txt'), 'utf8'), 'old2');
    assert.strictEqual(fs.readFileSync(path.join(exact.to, 'SKILL.md'), 'utf8').includes('version: 0.9.0'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cross-volume restore falls back to verified copy when linking fails', () => {
  const root = tmp('ys-converge-exdev-restore-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const trashRoot = path.join(root, 'trash');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(targetDir, 'yotta-test'), 'yotta-test', '0.9.0', 'old');
    writeSkill(path.join(targetDir, 'yotta-test__skillhub'), 'yotta-test', '0.9.0', 'old2');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot,
      renameEntry: exdevError,
      createLink: () => { throw new Error('boom'); },
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'error', JSON.stringify(item));
    assert.strictEqual(item.restored, true);
    assert.strictEqual(fs.readFileSync(path.join(targetDir, 'yotta-test', 'marker.txt'), 'utf8'), 'old');
    assert.strictEqual(fs.readFileSync(path.join(targetDir, 'yotta-test__skillhub', 'marker.txt'), 'utf8'), 'old2');
    assert.ok(!fs.lstatSync(path.join(targetDir, 'yotta-test')).isSymbolicLink());
    assert.deepStrictEqual(listFiles(trashRoot), [], 'trash must be empty after cross-volume restore');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('non-EXDEV rename failures do not fall back to copying', () => {
  const root = tmp('ys-converge-eperm-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const trashRoot = path.join(root, 'trash');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(targetDir, 'yotta-test'), 'yotta-test', '0.9.0', 'old');

    const result = hub.linkSkills({
      hubDir,
      targetDir,
      slugs: ['yotta-test'],
      manifest: manifestFor('yotta-test'),
      trashRoot,
      renameEntry: () => {
        const error = new Error('EPERM: operation not permitted');
        error.code = 'EPERM';
        throw error;
      },
    });
    const item = result.results[0];
    assert.strictEqual(item.status, 'error', JSON.stringify(item));
    assert.strictEqual(item.restored, true);
    assert.ok(fs.existsSync(path.join(targetDir, 'yotta-test', 'marker.txt')), 'host copy must stay');
    assert.deepStrictEqual(listFiles(trashRoot), [], 'no copy may be left behind');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pruneTrash removes entries older than the retention window', () => {
  const root = tmp('ys-trash-prune-');
  try {
    const trashRoot = path.join(root, 'trash');
    const oldDir = path.join(trashRoot, 'old-entry');
    const newDir = path.join(trashRoot, 'new-entry');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldDir, old, old);
    const pruned = hub.pruneTrash(trashRoot, { days: 7 });
    assert.strictEqual(pruned, 1);
    assert.ok(!fs.existsSync(oldDir));
    assert.ok(fs.existsSync(newDir));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('family scope includes the five special families', () => {
  const set = hub.familySlugSet([{ slug: 'yotta-anti-shallow' }]);
  for (const slug of ['yotta-dev-mcp', 'yotta-partner', 'yotta-present', 'yotta-skills', 'yotta-verify-mcp']) {
    assert.ok(set.has(slug), slug + ' should be part of the hub family scope');
  }
});

test('registry-fetch resolves the latest dist-tag for special families', () => {
  const packument = {
    versions: { '1.2.3': { dist: { tarball: 'https://example.com/1.2.3.tgz' } } },
    'dist-tags': { latest: '1.2.3' },
  };
  const resolved = registryFetch.resolveVersion(packument, { pkg: '@yottameta/yotta-present', version: 'latest' }, true);
  assert.strictEqual(resolved.version, '1.2.3');
  const missing = registryFetch.resolveVersion(
    { versions: {}, 'dist-tags': {} },
    { pkg: '@yottameta/yotta-present', version: 'latest' },
    true,
  );
  assert.ok(missing.error, 'missing latest must fail closed');
});

test('doctor reports duplicate family copies as a read-only warning', () => {
  const root = tmp('ys-single-source-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostDir = path.join(root, 'host', 'skills');
    writeSkill(path.join(hubDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(hostDir, 'yotta-test'), 'yotta-test', '1.0.0');
    writeSkill(path.join(hostDir, 'yotta-test__skillhub'), 'yotta-test', '1.0.0');
    const payload = hub.doctor({
      hubDir,
      manifest: manifestFor('yotta-test'),
      discovery: { hosts: [{ dir: hostDir, label: '测试宿主', agentId: 'testhost', exists: true }] },
    });
    const check = payload.checks.find((item) => item.id.startsWith('single_source:'));
    assert.ok(check, 'single_source check should exist');
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.severity, 'warning');
    assert.match(check.message, /2 份副本/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('strict frontmatter warnings flag the leading-comma form only', () => {
  const bad = scan.strictFrontmatterWarnings('---\nname: x\ntags: ,development,curated\n---\n');
  assert.strictEqual(bad.length, 1);
  const quoted = scan.strictFrontmatterWarnings('---\nname: x\ntags: ",development"\n---\n');
  assert.strictEqual(quoted.length, 0);
  const flow = scan.strictFrontmatterWarnings('---\nname: x\ntags: [development, curated]\n---\n');
  assert.strictEqual(flow.length, 0);
});

test('adopt scan attaches read-only standard warnings to external candidates', () => {
  const root = tmp('ys-adopt-warn-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostDir = path.join(root, 'host', 'skills');
    const dir = path.join(hostDir, 'custom-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'),
      '---\nname: custom-skill\nversion: 1.0.0\ntags: ,a,b\n---\n# x\n', 'utf8');
    const payload = hubAdopt.scanCandidates({
      hubDir,
      discovery: { hosts: [{ dir: hostDir, label: 'H', agentId: 'h', exists: true }] },
      manifest: [],
    });
    const candidate = payload.candidates.find((item) => item.slug === 'custom-skill');
    assert.ok(candidate);
    assert.ok(Array.isArray(candidate.standardWarnings));
    assert.strictEqual(candidate.standardWarnings.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
