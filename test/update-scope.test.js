'use strict';
/**
 * 范围回归（0.24.0 C 批）：update 默认补装 / --installed-only 不补装，
 * 含接管语义锁定（清单内未装不动、已管理已最新跳过、非家族目录忽略）。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(__dirname, 'helpers', 'fake-npm.js');

const BASE_SKILLS = [
  { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture alpha' },
  { slug: 'yotta-beta', name: '元乙', pkg: '@fake/beta', version: '0.2.0', domain: 'education', desc: 'fixture beta' },
];

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home, name, skills) {
  const file = path.join(home, name);
  fs.writeFileSync(file, JSON.stringify({ manifestVersion: 1, updated: '2026-10-02', skills }, null, 2) + '\n', 'utf8');
  return file;
}

function makeEnv(home, catalog, log) {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    YOTTA_SKILLS_MANIFEST: catalog,
    YOTTA_SKILLS_FAKE_CATALOG: catalog,
    YOTTA_SKILLS_NPM: FAKE_NPM,
    YOTTA_SKILLS_FETCH: 'npm',
    YOTTA_SKILLS_FAKE_LOG: log,
  };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

function readVersion(dest, slug) {
  const text = fs.readFileSync(path.join(dest, slug, 'SKILL.md'), 'utf8');
  return (text.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)/m) || [])[1] || null;
}

function readLog(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean);
}

test('update --installed-only：只更新已装、不补缺失、不产生多余网络请求', () => {
  const home = tmpdir('ys-scope-home-');
  const dest = tmpdir('ys-scope-dest-');
  try {
    const catalog1 = writeCatalog(home, 'skills.json', BASE_SKILLS);
    const install = runCli(
      ['install', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog1, path.join(home, 'pack1.log')),
    );
    assert.strictEqual(install.status, 0, install.stdout + install.stderr);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.1.0');

    const catalog2 = writeCatalog(home, 'skills-v2.json', BASE_SKILLS.map((s) => ({
      ...s,
      version: s.slug === 'yotta-alpha' ? '0.1.1' : '0.2.1',
    })));
    const log2 = path.join(home, 'pack2.log');
    const r = runCli(
      ['update', '--installed-only', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog2, log2),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.1.1');
    assert.ok(!fs.existsSync(path.join(dest, 'yotta-beta')), 'beta 不应被补装（未装不动）');
    const calls = readLog(log2);
    assert.strictEqual(calls.length, 1, '只应拉取已装的 alpha：' + calls.join('\n'));
    assert.ok(calls[0].includes('@fake/alpha@0.1.1'), calls[0]);
    assert.match(r.stdout, /范围: 仅已安装技能/);
    assert.match(r.stdout, /候选 2 \/ 已装 1/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('update --installed-only：已管理且已最新 → 跳过、退出码 0、不再拉包', () => {
  const home = tmpdir('ys-scope-latest-home-');
  const dest = tmpdir('ys-scope-latest-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', BASE_SKILLS);
    const install = runCli(
      ['install', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog, path.join(home, 'pack1.log')),
    );
    assert.strictEqual(install.status, 0, install.stdout + install.stderr);

    const log2 = path.join(home, 'pack2.log');
    const r = runCli(
      ['update', '--installed-only', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog, log2),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /已是最新/);
    assert.strictEqual(readLog(log2).length, 0, '已最新不应再拉包');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('update --installed-only：清单内但机器未装 → 无动作、无网络、退出码 0', () => {
  const home = tmpdir('ys-scope-empty-home-');
  const dest = tmpdir('ys-scope-empty-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', BASE_SKILLS);
    const log = path.join(home, 'pack.log');
    const r = runCli(
      ['update', '--installed-only', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog, log),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /无动作/);
    assert.strictEqual(readLog(log).length, 0, '未装技能不应产生网络请求');
    assert.deepStrictEqual(fs.readdirSync(dest), [], '不应新增任何技能目录');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('update --installed-only：非家族 / 未收录目录忽略不报错', () => {
  const home = tmpdir('ys-scope-other-home-');
  const dest = tmpdir('ys-scope-other-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', BASE_SKILLS);
    const log = path.join(home, 'pack.log');
    fs.mkdirSync(path.join(dest, 'yotta-present'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'yotta-present', 'SKILL.md'), '---\nname: yotta-present\nversion: 0.7.1\n---\n', 'utf8');
    fs.mkdirSync(path.join(dest, 'random-dir'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'random-dir', 'SKILL.md'), '---\nname: random-dir\nversion: 1.0.0\n---\n', 'utf8');

    const r = runCli(
      ['update', '--installed-only', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog, log),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /无动作/);
    assert.strictEqual(readLog(log).length, 0);
    assert.ok(fs.existsSync(path.join(dest, 'yotta-present', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(dest, 'random-dir', 'SKILL.md')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('update 无旗标：保持现状语义（补齐缺失 + 升级已装）', () => {
  const home = tmpdir('ys-scope-all-home-');
  const dest = tmpdir('ys-scope-all-dest-');
  try {
    const catalog1 = writeCatalog(home, 'skills.json', BASE_SKILLS);
    const install = runCli(
      ['install', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog1, path.join(home, 'pack1.log')),
    );
    assert.strictEqual(install.status, 0, install.stdout + install.stderr);

    const catalog2 = writeCatalog(home, 'skills-v2.json', BASE_SKILLS.map((s) => ({
      ...s,
      version: s.slug === 'yotta-alpha' ? '0.1.1' : '0.2.1',
    })));
    const log2 = path.join(home, 'pack2.log');
    const r = runCli(
      ['update', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog2, log2),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.1.1');
    assert.strictEqual(readVersion(dest, 'yotta-beta'), '0.2.1', '默认 update 应补齐缺失');
    assert.strictEqual(readLog(log2).length, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('install --installed-only 被拒绝（仅 update 可用，退出码 2）', () => {
  const home = tmpdir('ys-scope-usage-home-');
  const dest = tmpdir('ys-scope-usage-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', BASE_SKILLS);
    const r = runCli(['install', '--installed-only', '--dir', dest], makeEnv(home, catalog, path.join(home, 'pack.log')));
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--installed-only 只能与 update 一起使用/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
