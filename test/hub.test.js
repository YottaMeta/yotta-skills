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
const discovery = require('../lib/agent-discovery');

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

test('agent discovery finds an unknown host skill directory from the filesystem', () => {
  const home = tmp('ys-hub-home-');
  try {
    writeSkill(path.join(home, '.newagent', 'skills', 'custom-skill'), 'custom-skill', '1.2.3');
    const result = discovery.discoverHosts({
      homeDir: home,
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        CODEX_HOME: path.join(home, '.codex'),
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(home, '.state'),
        APPDATA: path.join(home, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
      },
      includeCwd: false,
    });
    const found = result.hosts.find((item) => item.dir === path.join(home, '.newagent', 'skills'));
    assert.ok(found, 'unknown host skills dir should be discovered');
    assert.strictEqual(found.exists, true);
    assert.strictEqual(found.skillCount, 1);
    assert.strictEqual(found.known, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub link creates a junction/symlink and scan follows it', () => {
  const root = tmp('ys-hub-link-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const source = path.join(hubDir, 'yotta-test');
    writeSkill(source, 'yotta-test', '0.1.0');

    const linked = hub.linkSkills({ hubDir, targetDir, slugs: ['yotta-test'] });
    assert.strictEqual(linked.results[0].status, 'linked', linked.results[0].note);
    const target = path.join(targetDir, 'yotta-test');
    assert.ok(fs.lstatSync(target).isSymbolicLink(), 'target should be a link');
    assert.strictEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8').includes('yotta-test'), true);

    const scan = require('../lib/skills-scan');
    const found = scan.scanSkillDir(targetDir);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].slug, 'yotta-test');

    const unlinked = hub.unlinkSkills({ hubDir, targetDir, slugs: ['yotta-test'] });
    assert.strictEqual(unlinked.results[0].status, 'unlinked');
    assert.ok(fs.existsSync(source), 'hub source must remain');
    assert.ok(!fs.existsSync(target), 'link should be removed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hub unlink is fail-closed for a real directory', () => {
  const root = tmp('ys-hub-unlink-');
  try {
    const hubDir = path.join(root, 'hub');
    const targetDir = path.join(root, 'host', 'skills');
    const source = path.join(hubDir, 'yotta-test');
    const realTarget = path.join(targetDir, 'yotta-test');
    writeSkill(source, 'yotta-test', '0.1.0');
    writeSkill(realTarget, 'yotta-test', '0.1.0');

    const result = hub.unlinkSkills({ hubDir, targetDir, slugs: ['yotta-test'] });
    assert.strictEqual(result.results[0].status, 'refused');
    assert.ok(fs.existsSync(realTarget), 'real directory must not be deleted');
    assert.ok(fs.existsSync(path.join(realTarget, 'SKILL.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI hub hosts --json reads filesystem discovery, not the memory registry', () => {
  const home = tmp('ys-hub-cli-home-');
  try {
    writeSkill(path.join(home, '.customagent', 'skills', 'custom-skill'), 'custom-skill', '9.9.9');
    const r = run(['hub', 'hosts', '--json'], {
      USERPROFILE: home,
      HOME: home,
      CODEX_HOME: path.join(home, '.codex'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_STATE_HOME: path.join(home, '.state'),
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
      YOTTA_SKILLS_DISCOVERY_ROOTS: '',
    }, home);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const data = JSON.parse(r.stdout);
    const found = data.hosts.find((item) => item.dir === path.join(home, '.customagent', 'skills'));
    assert.ok(found, 'custom host should be discovered');
    assert.strictEqual(found.skillCount, 1);
    assert.ok(!r.stdout.includes('.yottamemory'), 'must not read the memory registry');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI hub status reports hub standard and empty hub state', () => {
  const home = tmp('ys-hub-status-home-');
  const hubDir = path.join(home, 'hub');
  try {
    const r = run(['hub', 'status', '--hub', hubDir, '--json'], {
      USERPROFILE: home,
      HOME: home,
      CODEX_HOME: path.join(home, '.codex'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_STATE_HOME: path.join(home, '.state'),
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
    }, home);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.standard, hub.STANDARD_ID);
    assert.strictEqual(data.hubDir, hubDir);
    assert.strictEqual(data.summary.skills, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
