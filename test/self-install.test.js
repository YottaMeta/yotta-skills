'use strict';
/**
 * 0.29.0 F1：元阁独立安装（install-self）与位置查看（where）。
 *
 * 口径（老张 2026-10-04 确认）：保留原指定智能体安装；新增元阁独立安装
 * （默认 ~/.yottaskills/yotta-skills / --dir 指定位置）+ CLI 查看元阁位置。
 * fail-closed：Hub 真源 / 锁与数据桥接目录 / 非空陌生目录（--force 才覆盖）。
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const VERSION = require(path.join(ROOT, 'package.json')).version;

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

const RUNTIME_FILES = ['bin/yotta-skills.js', 'lib/hub.js', 'assets/view.html', 'package.json', 'skills.json', 'scan-policy.json'];

test('install-self：默认位置安装 + self.json 登记 + 安装副本可运行', () => {
  const home = tmp('ys-self-default-');
  try {
    const env = fakeEnv(home);
    const result = run(['install-self', '--json'], env);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const defaultDir = path.join(home, '.yottaskills', 'yotta-skills');
    assert.strictEqual(payload.action, 'install-self');
    assert.strictEqual(payload.dryRun, false);
    assert.strictEqual(payload.dir, defaultDir);
    assert.strictEqual(payload.version, VERSION);

    for (const rel of RUNTIME_FILES) {
      assert.ok(fs.existsSync(path.join(defaultDir, rel)), '缺少运行件: ' + rel);
    }
    const registry = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'self.json'), 'utf8'));
    assert.strictEqual(registry.version, 1);
    assert.strictEqual(registry.installs.length, 1);
    assert.strictEqual(registry.installs[0].dir, defaultDir);
    assert.strictEqual(registry.installs[0].version, VERSION);
    assert.ok(registry.installs[0].installedAt, '缺少 installedAt');
    assert.ok(registry.installs[0].source, '缺少 source');

    // E2E：安装副本可直接运行。
    const versionRun = spawnSync(process.execPath, [path.join(defaultDir, 'bin', 'yotta-skills.js'), '--version'], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    assert.strictEqual(versionRun.status, 0, versionRun.stderr);
    assert.match(versionRun.stdout, new RegExp(VERSION.replace(/\./g, '\\.')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install-self --dir：指定位置 + 重复安装幂等（同目录去重）', () => {
  const home = tmp('ys-self-dir-');
  try {
    const env = fakeEnv(home);
    const custom = path.join(home, 'opt', 'yotta-skills');
    const first = run(['install-self', '--dir', custom, '--json'], env);
    assert.strictEqual(first.status, 0, first.stderr);
    const second = run(['install-self', '--dir', custom, '--json'], env);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(JSON.parse(second.stdout).dir, custom);
    const registry = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'self.json'), 'utf8'));
    assert.strictEqual(registry.installs.filter((item) => item.dir === custom).length, 1,
      '重复安装不得重复登记');
    assert.ok(fs.existsSync(path.join(custom, 'bin', 'yotta-skills.js')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install-self --dry-run：只预览，无任何写入', () => {
  const home = tmp('ys-self-dry-');
  try {
    const env = fakeEnv(home);
    const result = run(['install-self', '--dry-run', '--json'], env);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.dryRun, true);
    assert.ok(Array.isArray(payload.files) && payload.files.length >= RUNTIME_FILES.length);
    assert.strictEqual(fs.existsSync(path.join(home, '.yottaskills', 'yotta-skills')), false);
    assert.strictEqual(fs.existsSync(path.join(home, '.yottaskills', 'self.json')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install-self fail-closed：Hub 真源 / 桥接目录 / 非空陌生目录（--force 覆盖）', () => {
  const home = tmp('ys-self-guard-');
  try {
    const env = fakeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    fs.mkdirSync(hubDir, { recursive: true });

    const hubAttempt = run(['install-self', '--dir', hubDir], env);
    assert.strictEqual(hubAttempt.status, 2);
    assert.match(hubAttempt.stderr, /Hub/);

    const bridge = path.join(home, '.state', 'skills');
    fs.mkdirSync(bridge, { recursive: true });
    const bridgeAttempt = run(['install-self', '--dir', bridge], env);
    assert.strictEqual(bridgeAttempt.status, 2);
    assert.match(bridgeAttempt.stderr, /桥接/);

    const stranger = path.join(home, 'stranger');
    fs.mkdirSync(stranger, { recursive: true });
    fs.writeFileSync(path.join(stranger, 'keep.txt'), 'user content', 'utf8');
    const strangerAttempt = run(['install-self', '--dir', stranger], env);
    assert.strictEqual(strangerAttempt.status, 2);
    assert.match(strangerAttempt.stderr, /非空|陌生|--force/);

    const forced = run(['install-self', '--dir', stranger, '--force', '--json'], env);
    assert.strictEqual(forced.status, 0, forced.stderr);
    assert.ok(fs.existsSync(path.join(stranger, 'bin', 'yotta-skills.js')));
    assert.strictEqual(fs.readFileSync(path.join(stranger, 'keep.txt'), 'utf8'), 'user content',
      '--force 覆盖不得删除无关用户文件');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('where：未独立安装时明示；安装后列出条目并标记当前运行项', () => {
  const home = tmp('ys-self-where-');
  try {
    const env = fakeEnv(home);
    const empty = run(['where', '--json'], env);
    assert.strictEqual(empty.status, 0, empty.stderr);
    const emptyPayload = JSON.parse(empty.stdout);
    assert.deepStrictEqual(emptyPayload.installs, []);
    assert.ok(emptyPayload.running, '缺少 running 路径');
    assert.ok(emptyPayload.hubDir, '缺少 hubDir');

    const emptyText = run(['where'], env);
    assert.strictEqual(emptyText.status, 0, emptyText.stderr);
    assert.match(emptyText.stdout, /未独立安装/);

    run(['install-self', '--json'], env);
    // 手工追加一条指向源码目录的登记：模拟"当前从该安装运行"的标记路径。
    const registryFile = path.join(home, '.yottaskills', 'self.json');
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    registry.installs.push({ dir: ROOT, version: VERSION, installedAt: new Date().toISOString(), source: 'test' });
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n', 'utf8');

    const where = run(['where', '--json'], env);
    assert.strictEqual(where.status, 0, where.stderr);
    const payload = JSON.parse(where.stdout);
    const current = payload.installs.find((item) => item.dir === ROOT);
    const other = payload.installs.find((item) => item.dir !== ROOT);
    assert.ok(current && current.current === true, '当前运行项必须标记 current=true');
    assert.ok(other && other.current === false, '非当前运行项必须 current=false');

    const text = run(['where'], env);
    assert.match(text.stdout, /独立安装/);
    assert.match(text.stdout, /当前运行项/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
