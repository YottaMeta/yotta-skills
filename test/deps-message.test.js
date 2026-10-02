'use strict';
/**
 * 依赖人话提示回归（0.24.0 B 批）：统一模板、doctor dependencies 块（只告警不失败）。
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
const deps = require('../lib/deps');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home, skills) {
  const file = path.join(home, 'skills.json');
  fs.writeFileSync(file, JSON.stringify({ manifestVersion: 1, updated: '2026-10-02', skills }, null, 2) + '\n', 'utf8');
  return file;
}

function makeEnv(home, catalog) {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    YOTTA_SKILLS_MANIFEST: catalog,
    YOTTA_SKILLS_FAKE_CATALOG: catalog,
    YOTTA_SKILLS_NPM: FAKE_NPM,
    YOTTA_SKILLS_FETCH: 'npm',
    YOTTA_SKILLS_FAKE_LOG: path.join(home, 'pack.log'),
  };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

test('describe 三行模板：需要 / 为什么 / 修复 / 不影响使用', () => {
  const message = deps.describe('python', {
    command: 'yotta-skills update --installed-only --dir X',
    missing: true,
  });
  assert.ok(message.includes('需要 Python 3.8+'), message);
  assert.ok(message.includes('用途：元信装前安全扫描'), message);
  assert.ok(message.includes('未找到 Python'), message);
  assert.ok(message.includes('装好后重跑：yotta-skills update --installed-only --dir X'), message);
  assert.ok(message.includes('修复：'), message);
  assert.ok(message.includes('或者：继续用宿主自带技能，不影响正常使用。'), message);
});

test('npm / tar 回退通道文案可复制修复', () => {
  const npm = deps.describe('npm', { command: 'yotta-skills install --dir X', missing: true });
  assert.ok(npm.includes('拉包回退通道'), npm);
  assert.ok(/修复：(winget install OpenJS\.NodeJS\.LTS|brew install node|sudo apt install)/.test(npm), npm);

  const tar = deps.describe('tar', { command: 'yotta-skills install --dir X', missing: true });
  assert.ok(tar.includes('解包回退通道'), tar);
  assert.ok(tar.includes('修复：'), tar);
});

test('nodeCheck 版本门槛（>=18）', () => {
  assert.strictEqual(deps.nodeCheck('16.20.0').ok, false);
  assert.strictEqual(deps.nodeCheck('18.0.0').ok, true);
  assert.strictEqual(deps.nodeCheck('24.19.0').ok, true);
});

test('dependencyReport：四项、字段齐全、缺失项给出修复', () => {
  const items = deps.dependencyReport({
    node: { version: '20.11.1' },
    npm: { found: false },
    python: { found: true, version: 'Python 3.12.4' },
    tar: { found: true, version: 'bsdtar 3.5.2' },
  });
  assert.deepStrictEqual(items.map((item) => item.name), ['node', 'npm', 'python', 'tar']);
  assert.strictEqual(items[0].ok, true);
  assert.strictEqual(items[1].ok, false);
  assert.strictEqual(items[1].optional, true);
  assert.ok(items[1].fix, 'npm 缺失应给出修复命令');
  assert.strictEqual(items[2].ok, true);
  assert.strictEqual(items[3].ok, true);

  const oldPython = deps.dependencyReport({ python: { found: true, version: 'Python 3.7.9' } });
  const python = oldPython.find((item) => item.name === 'python');
  assert.strictEqual(python.ok, false, '低于 3.8 应视为不满足');
  assert.ok(python.fix);
});

test('doctor --json 输出 dependencies 块（只告警不失败）', () => {
  const home = tmpdir('ys-deps-doctor-home-');
  const dest = tmpdir('ys-deps-doctor-dest-');
  try {
    const catalog = writeCatalog(home, [
      { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture' },
    ]);
    const env = makeEnv(home, catalog);
    const install = runCli(['install', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'], env);
    assert.strictEqual(install.status, 0, install.stdout + install.stderr);

    const r = runCli(['doctor', '--dir', dest, '--slug', 'yotta-alpha', '--json'], env);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const payload = JSON.parse(r.stdout);
    assert.ok(Array.isArray(payload.dependencies), 'dependencies 应为数组');
    assert.deepStrictEqual(payload.dependencies.map((item) => item.name), ['node', 'npm', 'python', 'tar']);
    for (const item of payload.dependencies) {
      for (const key of ['found', 'version', 'need', 'why', 'fix', 'ok', 'optional']) {
        assert.ok(key in item, item.name + ' 缺字段 ' + key);
      }
    }

    const text = runCli(['doctor', '--dir', dest, '--slug', 'yotta-alpha'], env);
    assert.strictEqual(text.status, 0, text.stdout + text.stderr);
    assert.match(text.stdout, /依赖自检（只告警不失败）/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
