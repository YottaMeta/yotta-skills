'use strict';
/**
 * 0.29.0 F2：自定义宿主注册（hub hosts add / remove / list / mark）。
 *
 * 存储 = <YOTTA_SKILLS_HOME>/hosts.json（schema v1，独立于 Hub 目录）。
 * fail-closed：目录不存在 / 不是目录 / Hub 自身或子目录 / 锁与数据桥接目录 /
 * 重复注册 / label 控制字符或超长。注册不创建目录、不改宿主配置；
 * 移除注册绝不删除目录。
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
}

function fakeEnv(home) {
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
    YOTTA_SKILLS_HOME: path.join(home, '.yottaskills'),
  };
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

test('hub hosts add / list / remove：注册、展示、移除（目录保留）', () => {
  const home = tmp('ys-reg-flow-');
  try {
    const env = fakeEnv(home);
    const custom = path.join(home, 'custom', 'skills');
    fs.mkdirSync(custom, { recursive: true });

    const add = run(['hub', 'hosts', 'add', custom, '--label', '我的宿主', '--json'], env);
    assert.strictEqual(add.status, 0, add.stderr);
    const added = JSON.parse(add.stdout);
    assert.strictEqual(added.entry.dir, custom);
    assert.strictEqual(added.entry.label, '我的宿主');
    assert.strictEqual(added.entry.source, 'manual');
    assert.strictEqual(added.entry.scope, 'verified');
    const registryFile = path.join(home, '.yottaskills', 'hosts.json');
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    assert.strictEqual(registry.version, 1);
    assert.strictEqual(registry.hosts.length, 1);

    const list = run(['hub', 'hosts', 'list', '--json'], env);
    assert.strictEqual(list.status, 0, list.stderr);
    assert.strictEqual(JSON.parse(list.stdout).hosts.length, 1);
    const listText = run(['hub', 'hosts', 'list'], env);
    assert.match(listText.stdout, /我的宿主/);

    const remove = run(['hub', 'hosts', 'remove', custom, '--json'], env);
    assert.strictEqual(remove.status, 0, remove.stderr);
    assert.ok(fs.existsSync(custom), '移除注册不得删除目录');
    assert.strictEqual(JSON.parse(fs.readFileSync(registryFile, 'utf8')).hosts.length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub hosts add fail-closed：不存在 / 文件 / Hub 自身 / 桥接 / 重复 / 非法 label', () => {
  const home = tmp('ys-reg-guard-');
  try {
    const env = fakeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    fs.mkdirSync(hubDir, { recursive: true });
    const custom = path.join(home, 'custom', 'skills');
    fs.mkdirSync(custom, { recursive: true });
    const filePath = path.join(home, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'x', 'utf8');
    const bridge = path.join(home, '.state', 'skills');
    fs.mkdirSync(bridge, { recursive: true });

    const missing = run(['hub', 'hosts', 'add', path.join(home, 'nope')], env);
    assert.strictEqual(missing.status, 2);
    assert.match(missing.stderr, /不存在/);

    const fileAttempt = run(['hub', 'hosts', 'add', filePath], env);
    assert.strictEqual(fileAttempt.status, 2);
    assert.match(fileAttempt.stderr, /不是目录/);

    const hubAttempt = run(['hub', 'hosts', 'add', hubDir], env);
    assert.strictEqual(hubAttempt.status, 2);
    assert.match(hubAttempt.stderr, /Hub/);

    const bridgeAttempt = run(['hub', 'hosts', 'add', bridge], env);
    assert.strictEqual(bridgeAttempt.status, 2);
    assert.match(bridgeAttempt.stderr, /桥接/);

    const first = run(['hub', 'hosts', 'add', custom], env);
    assert.strictEqual(first.status, 0, first.stderr);
    const dup = run(['hub', 'hosts', 'add', custom], env);
    assert.strictEqual(dup.status, 2);
    assert.match(dup.stderr, /已注册/);

    const other = path.join(home, 'other');
    fs.mkdirSync(other, { recursive: true });
    const badLabel = run(['hub', 'hosts', 'add', other, '--label', 'bad\u0001label'], env);
    assert.strictEqual(badLabel.status, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('注册后联动：link --all 纳入默认范围 + hub hosts 显示用户注册证据', () => {
  const home = tmp('ys-reg-link-');
  try {
    const env = fakeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'demo-skill'), 'demo-skill', '1.0.0');
    const custom = path.join(home, 'custom', 'skills');
    fs.mkdirSync(custom, { recursive: true });

    const add = run(['hub', 'hosts', 'add', custom, '--label', '自定义宿主'], env);
    assert.strictEqual(add.status, 0, add.stderr);

    const link = run(['hub', 'link', '--all', '--dry-run', '--json', '--hub', hubDir], env);
    assert.strictEqual(link.status, 0, link.stderr);
    const targets = JSON.parse(link.stdout).targets.map((target) => target.dir);
    assert.ok(targets.includes(custom), '注册目录必须进入 link --all 默认范围');

    const hosts = run(['hub', 'hosts', '--json'], env);
    assert.strictEqual(hosts.status, 0, hosts.stderr);
    const item = JSON.parse(hosts.stdout).hosts.find((host) => host.dir === custom);
    assert.ok(item, 'hub hosts 必须包含注册目录');
    assert.strictEqual(item.detection, 'user-registry');
    assert.strictEqual(item.state, 'available');
    assert.strictEqual(item.evidence.registry, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('审计：hub 存在时写 hosts.add / hosts.remove', () => {
  const home = tmp('ys-reg-audit-');
  try {
    const env = fakeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'demo-skill'), 'demo-skill', '1.0.0');
    const custom = path.join(home, 'custom', 'skills');
    fs.mkdirSync(custom, { recursive: true });

    run(['hub', 'hosts', 'add', custom], env);
    run(['hub', 'hosts', 'remove', custom], env);
    const audit = fs.readFileSync(path.join(hubDir, '.yotta-hub-audit.jsonl'), 'utf8');
    assert.match(audit, /"event":"hosts\.add"/);
    assert.match(audit, /"event":"hosts\.remove"/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub hosts mark：手动状态覆盖 + 非法状态拒绝', () => {
  const home = tmp('ys-reg-mark-');
  try {
    const env = fakeEnv(home);
    const custom = path.join(home, 'custom', 'skills');
    fs.mkdirSync(custom, { recursive: true });

    const mark = run(['hub', 'hosts', 'mark', custom, '--state', 'ignored', '--json'], env);
    assert.strictEqual(mark.status, 0, mark.stderr);
    assert.strictEqual(JSON.parse(mark.stdout).entry.manualState, 'ignored');

    const hosts = run(['hub', 'hosts', '--json'], env);
    const item = JSON.parse(hosts.stdout).hosts.find((host) => host.dir === custom);
    assert.strictEqual(item.state, 'ignored');
    assert.strictEqual(item.stateSource, 'manual');

    const bad = run(['hub', 'hosts', 'mark', custom, '--state', 'bogus'], env);
    assert.strictEqual(bad.status, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
