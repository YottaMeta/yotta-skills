'use strict';
/**
 * 0.29.1 U2：宿主矩阵与宿主范围修正回归。
 * 覆盖：配对确定性优选 / 不接管开关（发现·显示·链接三层）/ 目录覆盖 /
 * YottaCode 不接管（映射·env·扫描·注册）/ unpaired 单一真源 / CLI 集成。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dirs = require('../lib/agent-dirs');
const discovery = require('../lib/agent-discovery');
const hostsRegistry = require('../lib/hosts-registry');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  const target = path.join(dir, slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
}

function writeMarker(env, name) {
  const dir = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.lnk'), '', 'utf8');
}

function makeEnv(home) {
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

function runCli(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function optsFor(home, env) {
  return { homeDir: home, env: env || makeEnv(home) };
}

test('U2 配对优选：verified 主目录优先于自动发现的项目目录（消除 last-write-wins）', () => {
  const home = tmp('ys-u2-pair-');
  try {
    const main = path.join(home, '.cursor', 'skills');
    writeSkill(main, 'yotta-a', '1.0.0');
    writeSkill(main, 'yotta-b', '1.0.0');
    const project = path.join(home, 'work', '.cursor', 'skills');
    writeSkill(project, 'yotta-c', '1.0.0');
    writeMarker(makeEnv(home), 'Cursor');

    const found = discovery.discoverHosts(optsFor(home));
    const item = found.installed.find((x) => x.label === 'Cursor');
    assert.ok(item && item.hasSkillsDir, 'Cursor 标记应配对到技能目录');
    assert.ok(samePath(item.skillDir, main), '应选 verified 主目录而不是项目目录：' + item.skillDir);
    assert.strictEqual(item.skillCount, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 不接管（agent）：发现 / 显示三层跳过；include 恢复', () => {
  const home = tmp('ys-u2-excl-agent-');
  try {
    const env = makeEnv(home);
    const opts = { homeDir: home, env };
    writeSkill(path.join(home, '.cursor', 'skills'), 'yotta-a', '1.0.0');
    writeMarker(env, 'Cursor');

    const ex = hostsRegistry.excludeHost(opts, { target: 'cursor' });
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.entry.kind, 'agent');

    const found = discovery.discoverHosts(opts);
    assert.ok(!found.hosts.some((h) => h.agentId === 'cursor'), 'hosts 不应含 cursor');
    assert.ok(!found.installed.some((x) => x.label === 'Cursor'), 'installed 不应含 Cursor 标记');
    assert.ok(!discovery.unpairedMarkers(found).some((x) => x.label === 'Cursor'));

    const inc = hostsRegistry.includeHost(opts, { target: 'cursor' });
    assert.strictEqual(inc.ok, true);
    const restored = discovery.discoverHosts(opts);
    assert.ok(restored.hosts.some((h) => h.agentId === 'cursor'), '恢复后应重新发现');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 不接管（目录）：自定义目录三层跳过且幂等', () => {
  const home = tmp('ys-u2-excl-dir-');
  try {
    const opts = optsFor(home);
    const custom = path.join(home, 'custom', 'skills');
    writeSkill(custom, 'yotta-a', '1.0.0');

    const ex = hostsRegistry.excludeHost(opts, { target: custom });
    assert.strictEqual(ex.ok, true);
    assert.strictEqual(ex.entry.kind, 'dir');

    const found = discovery.discoverHosts(opts);
    assert.ok(!found.hosts.some((h) => samePath(h.dir, custom)));

    const again = hostsRegistry.excludeHost(opts, { target: custom });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.already, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 目录覆盖：override 生效 + 旧目录不进入默认发现；clear 恢复', () => {
  const home = tmp('ys-u2-override-');
  try {
    const opts = optsFor(home);
    const oldDir = path.join(home, '.box-agent', 'skills');
    writeSkill(oldDir, 'yotta-old', '1.0.0');
    const newDir = path.join(home, 'box-custom');
    writeSkill(newDir, 'yotta-new', '1.0.0');

    const set = hostsRegistry.setHostOverride(opts, { agentId: 'box', dir: newDir });
    assert.strictEqual(set.ok, true);
    const found = discovery.discoverHosts(opts);
    const host = found.hosts.find((h) => h.agentId === 'box');
    assert.ok(host, 'box 应被发现');
    assert.ok(samePath(host.dir, newDir));
    assert.strictEqual(host.detection, 'override');
    assert.ok(!found.hosts.some((h) => samePath(h.dir, oldDir)), '旧目录不应进入默认发现');

    const clear = hostsRegistry.clearHostOverride(opts, { agentId: 'box' });
    assert.strictEqual(clear.ok, true);
    const restored = discovery.discoverHosts(opts);
    assert.ok(restored.hosts.some((h) => h.agentId === 'box' && samePath(h.dir, oldDir)));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 YottaCode 不接管：映射 / env / 扫描 / 注册全部排除', () => {
  const home = tmp('ys-u2-yc-');
  try {
    const env = Object.assign(makeEnv(home), { YOTTACODE_HOME: path.join(home, 'yottacode-home') });
    const opts = { homeDir: home, env };
    const ycDir = path.join(home, '.yottacode', 'skills');
    writeSkill(ycDir, 'yotta-x', '1.0.0');
    writeSkill(path.join(env.YOTTACODE_HOME, 'skills'), 'yotta-y', '1.0.0');

    assert.ok(!dirs.knownRoots(opts).some((r) => dirs.isYottaCodeDir(r.dir)), 'knownRoots 不应含 .yottacode');
    assert.ok(!dirs.envRoots(opts).some((r) => samePath(r.dir, path.join(env.YOTTACODE_HOME, 'skills'))),
      'envRoots 不应含 YOTTACODE_HOME');

    const found = discovery.discoverHosts(opts);
    assert.ok(!found.hosts.some((h) => dirs.isYottaCodeDir(h.dir)), '发现层不应含 .yottacode');
    assert.ok(!found.hosts.some((h) => samePath(h.dir, path.join(env.YOTTACODE_HOME, 'skills'))),
      '发现层不应含 YOTTACODE_HOME');

    const add = hostsRegistry.addHost(opts, { dir: ycDir });
    assert.strictEqual(add.ok, false);
    assert.match(add.error, /YottaCode/);

    const ex = hostsRegistry.excludeHost(opts, { target: ycDir });
    assert.strictEqual(ex.ok, false);
    assert.match(ex.error, /YottaCode/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 unpaired 单一真源：已配对标记不进「无技能目录」区', () => {
  const home = tmp('ys-u2-unpaired-');
  try {
    const env = makeEnv(home);
    writeSkill(path.join(home, '.cursor', 'skills'), 'yotta-a', '1.0.0');
    writeMarker(env, 'Cursor');
    writeMarker(env, 'Cherry Studio');

    const found = discovery.discoverHosts({ homeDir: home, env });
    const unpaired = discovery.unpairedMarkers(found);
    assert.ok(unpaired.some((x) => x.label === 'Cherry Studio'), JSON.stringify(unpaired));
    assert.ok(!unpaired.some((x) => x.label === 'Cursor'));
    assert.ok(unpaired.every((x) => !x.hasSkillsDir));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 CLI：hub hosts exclude -> 发现与 link --all 均跳过；include 恢复', () => {
  const home = tmp('ys-u2-cli-');
  try {
    const env = makeEnv(home);
    writeSkill(path.join(home, '.cursor', 'skills'), 'yotta-a', '1.0.0');
    writeMarker(env, 'Cursor');
    const hubDir = path.join(home, 'hub');
    writeSkill(hubDir, 'yotta-a', '1.0.0');

    const ex = runCli(['hub', 'hosts', 'exclude', 'cursor', '--json'], env);
    assert.strictEqual(ex.status, 0, ex.stdout + ex.stderr);
    assert.strictEqual(JSON.parse(ex.stdout).entry.kind, 'agent');

    const hosts = runCli(['hub', 'hosts'], env);
    assert.strictEqual(hosts.status, 0, hosts.stderr);
    assert.ok(!hosts.stdout.includes('Cursor'), '发现视图不应含 Cursor：' + hosts.stdout);

    const link = runCli(['hub', 'link', '--all', '--hub', hubDir, '--json'], env);
    assert.strictEqual(link.status, 0, link.stdout + link.stderr);
    const payload = JSON.parse(link.stdout);
    assert.ok(!(payload.targets || []).some((t) => /\.cursor/i.test(t.dir)),
      'link --all 不应链接 cursor：' + JSON.stringify(payload.targets));

    const inc = runCli(['hub', 'hosts', 'include', 'cursor', '--json'], env);
    assert.strictEqual(inc.status, 0, inc.stdout + inc.stderr);
    const hosts2 = runCli(['hub', 'hosts'], env);
    assert.ok(hosts2.stdout.includes('Cursor'), '恢复后应重新出现：' + hosts2.stdout);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 CLI：hub hosts set 覆盖目录 + --clear 恢复默认', () => {
  const home = tmp('ys-u2-cli-set-');
  try {
    const env = makeEnv(home);
    const newDir = path.join(home, 'box-custom');
    writeSkill(newDir, 'yotta-b', '1.0.0');

    const set = runCli(['hub', 'hosts', 'set', 'box', '--dir', newDir, '--json'], env);
    assert.strictEqual(set.status, 0, set.stdout + set.stderr);
    assert.ok(samePath(JSON.parse(set.stdout).entry.dir, newDir));

    const hosts = runCli(['hub', 'hosts'], env);
    assert.ok(hosts.stdout.includes('box-custom'), hosts.stdout);

    const list = runCli(['hub', 'hosts', 'list', '--json'], env);
    assert.strictEqual(JSON.parse(list.stdout).overrides.length, 1);

    const clear = runCli(['hub', 'hosts', 'set', 'box', '--clear', '--json'], env);
    assert.strictEqual(clear.status, 0, clear.stdout + clear.stderr);
    assert.strictEqual(JSON.parse(clear.stdout).cleared, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
