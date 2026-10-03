'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const hub = require('../lib/hub');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n',
    'utf8');
  fs.writeFileSync(path.join(dir, 'marker.txt'), slug + '@' + version, 'utf8');
}

function run(args, env, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: cwd || ROOT,
    env: { ...process.env, ...(env || {}) },
  });
}

function readAudit(hubDir) {
  const file = hub.hubPaths(hubDir).audit;
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('hub remove: normal path cleans links, trashes hub entry, updates ledgers and audit', () => {
  const root = tmp('ys-hub-remove-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const hostB = path.join(root, 'host-b', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });
    hub.linkSkills({ hubDir, targetDir: hostB, slugs: [slug], manifest: [slug] });

    const payload = hub.removeSkills({
      hubDir,
      slug,
      targets: [{ dir: hostA, label: 'A' }, { dir: hostB, label: 'B' }],
    });

    assert.strictEqual(payload.verdict, 'removed', JSON.stringify(payload));
    assert.strictEqual(payload.exitCode, 0);
    assert.ok(!fs.existsSync(path.join(hostA, slug)), 'host A link must be removed');
    assert.ok(!fs.existsSync(path.join(hostB, slug)), 'host B link must be removed');
    assert.ok(!fs.existsSync(path.join(hubDir, slug)), 'hub entry must be moved away');
    assert.ok(payload.trashedTo && fs.existsSync(payload.trashedTo), 'trash copy must exist');
    assert.ok(fs.existsSync(path.join(payload.trashedTo, 'SKILL.md')), 'trash copy must keep content');
    assert.strictEqual(hub.readHubState(hubDir).skills[slug], undefined, 'hub state entry must be deleted');
    assert.strictEqual(hub.readLinkState(hubDir).links.length, 0, 'link ledger must be cleared');
    assert.strictEqual(hub.linkStatus(hubDir).length, 0, 'no dangling link records');
    const audit = readAudit(hubDir);
    assert.ok(audit.some((entry) => entry.event === 'remove' && entry.verdict === 'removed'), 'audit must record remove');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub remove: cleans dead links and missing ledger after the hub entry was deleted manually', () => {
  const root = tmp('ys-hub-remove-broken-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });
    fs.rmSync(path.join(hubDir, slug), { recursive: true, force: true });
    assert.strictEqual(hub.linkStatus(hubDir)[0].status, 'broken');

    const payload = hub.removeSkills({ hubDir, slug, targets: [{ dir: hostA, label: 'A' }] });

    assert.strictEqual(payload.verdict, 'cleanup-only', JSON.stringify(payload));
    assert.strictEqual(payload.exitCode, 0);
    assert.ok(!fs.existsSync(path.join(hostA, slug)), 'dead link must be removed');
    assert.strictEqual(hub.readHubState(hubDir).skills[slug], undefined, 'missing state entry must be purged');
    assert.strictEqual(hub.readLinkState(hubDir).links.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub remove: keeps a link that points outside the hub (fail-closed) but still removes the hub entry', () => {
  const root = tmp('ys-hub-remove-external-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const outside = path.join(root, 'outside', 'yotta-test');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    writeSkill(outside, slug, '1.0.0');
    fs.mkdirSync(hostA, { recursive: true });
    fs.symlinkSync(outside, path.join(hostA, slug), process.platform === 'win32' ? 'junction' : 'dir');

    const payload = hub.removeSkills({ hubDir, slug, targets: [{ dir: hostA, label: 'A' }] });

    assert.strictEqual(payload.verdict, 'removed');
    assert.strictEqual(payload.exitCode, 0);
    assert.ok(fs.existsSync(path.join(hostA, slug)), 'external link must be kept');
    assert.ok(fs.existsSync(path.join(outside, 'SKILL.md')), 'external target must be untouched');
    assert.ok(!fs.existsSync(path.join(hubDir, slug)), 'hub entry still removed');
    assert.strictEqual(payload.kept[0].status, 'refused');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub remove: keeps real host copies and reports the version gate when the host copy is newer', () => {
  const root = tmp('ys-hub-remove-gate-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const hostB = path.join(root, 'host-b', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    writeSkill(path.join(hostA, slug), slug, '2.0.0');
    writeSkill(path.join(hostB, slug), slug, '0.5.0');

    const payload = hub.removeSkills({
      hubDir,
      slug,
      targets: [{ dir: hostA, label: 'A' }, { dir: hostB, label: 'B' }],
    });

    assert.strictEqual(payload.verdict, 'removed');
    assert.strictEqual(payload.kept.length, 2);
    const gate = payload.kept.find((item) => item.dir === hostA);
    const lower = payload.kept.find((item) => item.dir === hostB);
    assert.strictEqual(gate.versionGate, true, 'newer host copy must be reported as version gate');
    assert.strictEqual(lower.versionGate, undefined);
    assert.ok(fs.existsSync(path.join(hostA, slug, 'SKILL.md')), 'real host copy must be kept');
    assert.ok(fs.existsSync(path.join(hostB, slug, 'SKILL.md')), 'real host copy must be kept');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub remove: dry-run performs zero writes', () => {
  const root = tmp('ys-hub-remove-dry-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });
    const auditBefore = readAudit(hubDir).length;

    const payload = hub.removeSkills({ hubDir, slug, targets: [{ dir: hostA, label: 'A' }], dryRun: true });

    assert.strictEqual(payload.verdict, 'dry-run');
    assert.strictEqual(payload.unlinkable, 1);
    assert.ok(fs.existsSync(path.join(hubDir, slug)), 'hub entry must remain on dry-run');
    assert.ok(fs.existsSync(path.join(hostA, slug)), 'link must remain on dry-run');
    assert.strictEqual(hub.readLinkState(hubDir).links.length, 1);
    assert.strictEqual(readAudit(hubDir).length, auditBefore, 'dry-run must not write audit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub remove: unlink failure aborts before the hub entry is touched', () => {
  const root = tmp('ys-hub-remove-unlink-fail-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });

    const payload = hub.removeSkills({
      hubDir,
      slug,
      targets: [{ dir: hostA, label: 'A' }],
      unlink: () => ({ results: [{ status: 'error', note: 'EPERM (test injection)' }] }),
    });

    assert.strictEqual(payload.verdict, 'failed');
    assert.strictEqual(payload.exitCode, 1);
    assert.ok(fs.existsSync(path.join(hubDir, slug)), 'hub entry must remain after unlink failure');
    assert.ok(fs.existsSync(path.join(hostA, slug)), 'link must remain (injected failure did not remove)');
    assert.strictEqual(hub.readHubState(hubDir).skills[slug].status, 'present');
    const audit = readAudit(hubDir);
    assert.ok(audit.some((entry) => entry.event === 'remove' && entry.verdict === 'failed' && entry.reason === 'unlink-error'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub remove: trash failure keeps the hub entry and reports the failure', () => {
  const root = tmp('ys-hub-remove-trash-fail-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });

    const payload = hub.removeSkills({
      hubDir,
      slug,
      targets: [{ dir: hostA, label: 'A' }],
      renameEntry: () => { const error = new Error('EPERM (test injection)'); error.code = 'EPERM'; throw error; },
    });

    assert.strictEqual(payload.verdict, 'failed');
    assert.strictEqual(payload.exitCode, 1);
    assert.ok(fs.existsSync(path.join(hubDir, slug)), 'hub entry must remain after trash failure');
    assert.ok(!fs.existsSync(path.join(hostA, slug)), 'links were already cleaned before the trash phase');
    const audit = readAudit(hubDir);
    assert.ok(audit.some((entry) => entry.event === 'remove' && entry.reason === 'trash-error'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub remove: no traces at all exits 4 without creating a hub', () => {
  const root = tmp('ys-hub-remove-none-');
  try {
    const hubDir = path.join(root, 'hub');
    const payload = hub.removeSkills({ hubDir, slug: 'yotta-none', targets: [] });
    assert.strictEqual(payload.verdict, 'not-found');
    assert.strictEqual(payload.exitCode, 4);
    assert.ok(!fs.existsSync(hubDir), 'not-found must not create the hub directory');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI hub remove: full scope + --json removes link and hub entry end to end', () => {
  const root = tmp('ys-hub-remove-cli-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });

    const env = { USERPROFILE: root, HOME: root, CODEX_HOME: path.join(root, '.codex') };
    const r = run(['hub', 'remove', slug, '--hub', hubDir, '--json'], env);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(r.stdout);
    assert.strictEqual(payload.verdict, 'removed');
    assert.ok(!fs.existsSync(path.join(hostA, slug)));
    assert.ok(!fs.existsSync(path.join(hubDir, slug)));
    assert.ok(payload.trashedTo && fs.existsSync(payload.trashedTo));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI hub remove: --dry-run leaves everything in place', () => {
  const root = tmp('ys-hub-remove-cli-dry-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });

    const env = { USERPROFILE: root, HOME: root, CODEX_HOME: path.join(root, '.codex') };
    const r = run(['hub', 'remove', slug, '--hub', hubDir, '--dry-run', '--json'], env);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(r.stdout);
    assert.strictEqual(payload.verdict, 'dry-run');
    assert.ok(fs.existsSync(path.join(hostA, slug)));
    assert.ok(fs.existsSync(path.join(hubDir, slug)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI hub remove: missing slug exits 2 with a human hint', () => {
  const r = run(['hub', 'remove']);
  assert.strictEqual(r.status, 2, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /hub remove 需要一个且仅一个技能 slug/);
});

test('CLI hub link/unlink: distributes one skill to a specified agent only', () => {
  const root = tmp('ys-hub-agent-link-');
  try {
    const home = path.join(root, 'home');
    const hubDir = path.join(root, 'hub');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    const env = { USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex') };

    const linked = run(['hub', 'link', slug, '--agent', 'codex', '--hub', hubDir, '--json'], env);
    assert.strictEqual(linked.status, 0, linked.stderr + linked.stdout);
    const linkTarget = path.join(home, '.codex', 'skills', slug);
    assert.ok(fs.lstatSync(linkTarget).isSymbolicLink(), 'specified agent must receive a link');
    assert.ok(fs.readFileSync(path.join(linkTarget, 'SKILL.md'), 'utf8').includes(slug));

    const unlinked = run(['hub', 'unlink', slug, '--agent', 'codex', '--hub', hubDir, '--json'], env);
    assert.strictEqual(unlinked.status, 0, unlinked.stderr + unlinked.stdout);
    let remains = true;
    try { fs.lstatSync(linkTarget); } catch (_) { remains = false; }
    assert.strictEqual(remains, false, 'specified agent link must be removed by hub unlink');
    assert.ok(fs.existsSync(path.join(hubDir, slug)), 'hub source must stay');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI hub remove: narrowed --dir is refused while the hub entry exists (fail-closed)', () => {
  const root = tmp('ys-hub-remove-narrow-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });

    const r = run(['hub', 'remove', slug, '--dir', hostA, '--hub', hubDir]);
    assert.strictEqual(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr + r.stdout, /只用于清理 Hub 目标已缺失的死链/);
    assert.ok(fs.existsSync(path.join(hubDir, slug)), 'hub entry must stay');
    assert.ok(fs.existsSync(path.join(hostA, slug)), 'link must stay');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI hub remove: narrowed --dir cleans dead links when the hub entry is already gone', () => {
  const root = tmp('ys-hub-remove-narrow-cleanup-');
  try {
    const hubDir = path.join(root, 'hub');
    const hostA = path.join(root, 'host-a', 'skills');
    const slug = 'yotta-test';
    writeSkill(path.join(hubDir, slug), slug, '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostA, slugs: [slug], manifest: [slug] });
    fs.rmSync(path.join(hubDir, slug), { recursive: true, force: true });

    const r = run(['hub', 'remove', slug, '--dir', hostA, '--hub', hubDir, '--json']);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(r.stdout);
    assert.strictEqual(payload.verdict, 'cleanup-only');
    assert.ok(!fs.existsSync(path.join(hostA, slug)), 'dead link must be cleaned');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
