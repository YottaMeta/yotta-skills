'use strict';
/**
 * 0.28.0 链接范围收口：hub link --all 默认只链已核实宿主；
 * --include-discovered 显式扩围；state / data 桥接目录永不作为链接目标。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

function fakeHomeEnv(home) {
  return {
    USERPROFILE: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
    XDG_DATA_HOME: path.join(home, '.data'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    ProgramFiles: path.join(home, 'ProgramFiles'),
    'ProgramFiles(x86)': path.join(home, 'ProgramFilesX86'),
    YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
  };
}

function makeFixture(home) {
  const hubDir = path.join(home, 'hub');
  writeSkill(path.join(hubDir, 'demo-skill'), 'demo-skill');
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });            // verified mapping
  fs.mkdirSync(path.join(home, 'project-a', '.claude', 'skills'), { recursive: true }); // discovered
  fs.mkdirSync(path.join(home, '.state', 'skills'), { recursive: true });              // bridge
  return hubDir;
}

test('hub link --all defaults to verified hosts; --include-discovered widens; bridges never', () => {
  const home = tmp('ys-scope-');
  try {
    const hubDir = makeFixture(home);
    const env = fakeHomeEnv(home);

    const base = run(['hub', 'link', '--all', '--dry-run', '--json', '--hub', hubDir], env);
    assert.strictEqual(base.status, 0, base.stderr);
    const baseDirs = JSON.parse(base.stdout).targets.map((target) => target.dir);
    assert.ok(baseDirs.some((dir) => dir === path.join(home, '.claude', 'skills')), 'verified host must be included');
    assert.ok(!baseDirs.some((dir) => dir === path.join(home, 'project-a', '.claude', 'skills')),
      'discovered host must be skipped by default');
    assert.ok(!baseDirs.some((dir) => dir === path.join(home, '.state', 'skills')),
      'bridge dir must never be a link target');

    const wide = run(['hub', 'link', '--all', '--include-discovered', '--dry-run', '--json', '--hub', hubDir], env);
    assert.strictEqual(wide.status, 0, wide.stderr);
    const wideDirs = JSON.parse(wide.stdout).targets.map((target) => target.dir);
    assert.ok(wideDirs.some((dir) => dir === path.join(home, 'project-a', '.claude', 'skills')),
      '--include-discovered must add discovered hosts');
    assert.ok(!wideDirs.some((dir) => dir === path.join(home, '.state', 'skills')),
      'bridge dir stays excluded even with --include-discovered');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('explicit --dir on a bridge dir is refused (fail-closed)', () => {
  const home = tmp('ys-scope-bridge-');
  try {
    const hubDir = path.join(home, 'hub');
    writeSkill(path.join(hubDir, 'demo-skill'), 'demo-skill');
    const env = fakeHomeEnv(home);
    const state = path.join(home, '.state', 'skills');
    fs.mkdirSync(state, { recursive: true });
    const result = run(['hub', 'link', '--dir', state, '--hub', hubDir], env);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /桥接目录/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub hosts labels verified / discovered / bridge dirs', () => {
  const home = tmp('ys-scope-hosts-');
  try {
    makeFixture(home);
    const env = fakeHomeEnv(home);
    const result = run(['hub', 'hosts'], env);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('[已核实]'), result.stdout);
    assert.ok(result.stdout.includes('[自动发现·默认不链]'), result.stdout);
    assert.ok(result.stdout.includes('[桥接·不链接]'), result.stdout);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub doctor warns about links outside the default scope', () => {
  const home = tmp('ys-scope-doctor-');
  try {
    const hubDir = path.join(home, 'hub');
    writeSkill(path.join(hubDir, 'demo-skill'), 'demo-skill');
    const inScope = path.join(home, '.claude', 'skills');
    const outScope = path.join(home, 'project-b', '.claude', 'skills');
    fs.mkdirSync(inScope, { recursive: true });
    fs.mkdirSync(outScope, { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(hubDir, 'demo-skill'), path.join(inScope, 'demo-skill'), linkType);
    fs.symlinkSync(path.join(hubDir, 'demo-skill'), path.join(outScope, 'demo-skill'), linkType);
    fs.writeFileSync(path.join(hubDir, '.yotta-links.json'), JSON.stringify({
      standard: 'yotta-skills-hub/v1',
      version: 1,
      updatedAt: null,
      links: [
        { slug: 'demo-skill', dir: inScope, target: path.join(inScope, 'demo-skill'), hubDir: path.join(hubDir, 'demo-skill') },
        { slug: 'demo-skill', dir: outScope, target: path.join(outScope, 'demo-skill'), hubDir: path.join(hubDir, 'demo-skill') },
      ],
    }, null, 2), 'utf8');
    const env = fakeHomeEnv(home);
    const result = run(['hub', 'doctor', '--json', '--hub', hubDir], env);
    const payload = JSON.parse(result.stdout);
    const scopeChecks = payload.checks.filter((check) => String(check.id).startsWith('link_scope:'));
    assert.strictEqual(scopeChecks.length, 1, JSON.stringify(scopeChecks));
    assert.ok(scopeChecks[0].id.includes('project-b'), scopeChecks[0].id);
    assert.strictEqual(scopeChecks[0].severity, 'warning');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
