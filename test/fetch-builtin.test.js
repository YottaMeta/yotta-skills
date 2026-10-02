'use strict';
/**
 * 内置拉包 / 内置解包回归（0.24.0 A 批）：
 * packument 解析、integrity/shasum fail-closed、tar 解析与安全拒绝、回退链与 Node-only E2E。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(__dirname, 'helpers', 'fake-npm.js');
const fetchLib = require('../lib/registry-fetch');
const untarLib = require('../lib/untar');
const pipelineLib = require('../lib/install-pipeline');
const { startMockRegistry } = require('./helpers/mock-registry');
const { makeTgz, packageEntries } = require('./helpers/tar-fixture');

// 本地 mock registry 不应被宿主代理拦截。
process.env.NO_PROXY = '127.0.0.1,localhost';
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home, skills) {
  const file = path.join(home, 'skills.json');
  fs.writeFileSync(file, JSON.stringify({ manifestVersion: 1, updated: '2026-10-02', skills }, null, 2) + '\n', 'utf8');
  return file;
}

function makeEnv(home, catalog, extra) {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    YOTTA_SKILLS_MANIFEST: catalog,
    YOTTA_SKILLS_FAKE_CATALOG: catalog,
    YOTTA_SKILLS_FAKE_LOG: path.join(home, 'pack.log'),
    NO_PROXY: '127.0.0.1,localhost',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ...(extra || {}),
  };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

/** 需要 mock registry 同进程存活时必须用异步 spawn（spawnSync 会堵住测试事件环）。 */
function runCliAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolve({ status: code, signal, stdout, stderr }));
  });
}

function paxRecord(key, value) {
  const body = key + '=' + value + '\n';
  let length = Buffer.byteLength(body) + 2;
  while (String(length).length + 1 + Buffer.byteLength(body) !== length) {
    length = String(length).length + 1 + Buffer.byteLength(body);
  }
  return String(length) + ' ' + body;
}

test('parseIntegrity：多算法取最强（sha512 优先）', () => {
  const parsed = fetchLib.parseIntegrity('sha1-AAAA sha256-BBBB sha512-CCCC');
  assert.deepStrictEqual(parsed, { algo: 'sha512', base64: 'CCCC' });
  assert.strictEqual(fetchLib.parseIntegrity(''), null);
});

test('resolveVersion：pin 取精确版本，range 取同 major 最高正式版本', () => {
  const packument = {
    'dist-tags': { latest: '1.2.0' },
    versions: {
      '1.0.0': { dist: {} },
      '1.1.0': { dist: {} },
      '1.2.0': { dist: {} },
      '1.3.0-beta.1': { dist: {} },
      '2.0.0': { dist: {} },
    },
  };
  const skill = { pkg: '@fake/alpha', version: '1.0.0' };
  assert.strictEqual(fetchLib.resolveVersion(packument, skill, true).version, '1.0.0');
  assert.strictEqual(fetchLib.resolveVersion(packument, skill, false).version, '1.2.0');
  assert.ok(fetchLib.resolveVersion(packument, { pkg: '@fake/alpha', version: '9.0.0' }, true).error);
});

test('fetchPackage：内置通道 + integrity 校验通过并落盘', async () => {
  const server = await startMockRegistry([{ slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0' }]);
  const packDir = tmpdir('ys-fetch-pack-');
  try {
    const result = await fetchLib.fetchPackage(
      { slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0' },
      { registry: server.url },
      packDir,
    );
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.resolved, '0.1.0');
    assert.ok(fs.existsSync(result.tarball), 'tarball 应落盘');
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
    await server.close();
  }
});

test('fetchPackage：integrity 篡改 → fail-closed 并删除下载文件', async () => {
  const server = await startMockRegistry([{ slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0', integrity: 'bad' }]);
  const packDir = tmpdir('ys-fetch-bad-');
  try {
    const result = await fetchLib.fetchPackage(
      { slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0' },
      { registry: server.url },
      packDir,
    );
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /integrity 校验失败/);
    assert.ok(!fs.existsSync(path.join(packDir, 'fake-alpha-0.1.0.tgz')), '校验失败的文件必须删除');
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
    await server.close();
  }
});

test('fetchPackage：无 integrity 时 shasum 兜底；两者皆无 → 拒绝', async () => {
  const server = await startMockRegistry([
    { slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0', integrity: 'missing' },
    { slug: 'yotta-beta', pkg: '@fake/beta', version: '0.2.0', integrity: 'missing', shasum: 'missing' },
  ]);
  const packDir = tmpdir('ys-fetch-sha-');
  try {
    const ok = await fetchLib.fetchPackage(
      { slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0' },
      { registry: server.url },
      packDir,
    );
    assert.strictEqual(ok.ok, true, ok.error);

    const rejected = await fetchLib.fetchPackage(
      { slug: 'yotta-beta', pkg: '@fake/beta', version: '0.2.0' },
      { registry: server.url },
      packDir,
    );
    assert.strictEqual(rejected.ok, false);
    assert.match(rejected.error, /缺少 integrity \/ shasum/);
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
    await server.close();
  }
});

test('untar：正常解包（含 pax 长路径与可执行位）', () => {
  const longPath = 'package/references/' + 'a'.repeat(130) + '.md';
  const entries = [
    ...packageEntries({ slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0' }),
    { name: 'package/bin/tool.sh', data: '#!/bin/sh\necho ok\n', mode: 0o755 },
    { name: 'PaxHeaders/long', type: 'x', data: paxRecord('path', longPath) },
    { name: 'package/references/placeholder.md', data: 'long-path-content' },
  ];
  const tarball = path.join(tmpdir('ys-untar-tgz-'), 'pkg.tgz');
  fs.writeFileSync(tarball, makeTgz(entries));
  const extractDir = tmpdir('ys-untar-out-');
  try {
    const result = untarLib.extractTarballBuiltin(tarball, extractDir);
    assert.strictEqual(result.error, undefined, result.error);
    assert.ok(fs.existsSync(path.join(result.pkgDir, 'SKILL.md')));
    assert.strictEqual(
      fs.readFileSync(path.join(extractDir, longPath), 'utf8'),
      'long-path-content',
      'pax 长路径应还原',
    );
    if (process.platform !== 'win32') {
      assert.ok(fs.statSync(path.join(result.pkgDir, 'bin', 'tool.sh')).mode & 0o111, '可执行位应保留');
    }
  } finally {
    fs.rmSync(path.dirname(tarball), { recursive: true, force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
});

test('untar：拒绝路径越界 / 绝对路径 / 符号链接 / 缺 SKILL.md', () => {
  const cases = [
    { name: '路径越界', entries: [{ name: 'package/../evil.txt', data: 'x' }], match: /不安全路径/ },
    { name: '绝对路径', entries: [{ name: '/evil.txt', data: 'x' }], match: /不安全路径/ },
    { name: '符号链接', entries: [...packageEntries({ slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0' }), { name: 'package/link', type: '2', data: 'target' }], match: /链接条目/ },
    { name: '缺 SKILL.md', entries: [{ name: 'package/', type: '5', data: '' }], match: /缺少 SKILL.md/ },
  ];
  for (const item of cases) {
    const dir = tmpdir('ys-untar-bad-');
    const tarball = path.join(dir, 'pkg.tgz');
    fs.writeFileSync(tarball, makeTgz(item.entries));
    const extractDir = path.join(dir, 'out');
    try {
      const result = untarLib.extractTarballBuiltin(tarball, extractDir);
      assert.ok(result.error, item.name + ' 应被拒绝');
      assert.match(result.error, item.match, item.name + ' 错误文案: ' + result.error);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('untar 与安装管线共用同一安全路径口径（parity）', () => {
  const samples = [
    'package',
    'package/a',
    'package/a/b.txt',
    'package/../a',
    'package/a/../../b',
    '/package/a',
    'C:/package/a',
    'C:\\package\\a',
    'other/a',
    '',
  ];
  for (const sample of samples) {
    assert.strictEqual(
      untarLib.isSafeTarEntry(sample),
      pipelineLib.isSafeTarEntry(sample),
      '口径不一致: ' + sample,
    );
  }
});

test('Node-only E2E：PATH 隔离（无 npm/tar/python）下内置拉包 + 内置解包 + --skip-scan', async () => {
  const server = await startMockRegistry([{ slug: 'yotta-alpha', pkg: '@fake/alpha', version: '0.1.0' }]);
  const home = tmpdir('ys-nodeonly-home-');
  const dest = tmpdir('ys-nodeonly-dest-');
  const emptyPath = tmpdir('ys-empty-path-');
  try {
    const catalog = writeCatalog(home, [
      { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture' },
    ]);
    const env = makeEnv(home, catalog, {
      YOTTA_SKILLS_REGISTRY: server.url,
      YOTTA_SKILLS_FETCH: 'builtin',
      PATH: emptyPath,
    });
    const r = await runCliAsync(['install', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'], env);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(dest, 'yotta-alpha', 'SKILL.md')));
    const log = fs.readFileSync(path.join(home, '.yottaskills', 'install-log.jsonl'), 'utf8');
    assert.match(log, /"fetch_channel":"builtin"/);
    assert.match(log, /"extract_channel":"builtin"/);
    assert.match(log, /explicit-unverified/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.rmSync(emptyPath, { recursive: true, force: true });
    await server.close();
  }
});

test('回退链：内置失败 → npm 回退成功，证据记 fetch_channel=npm', () => {
  const home = tmpdir('ys-fallback-home-');
  const dest = tmpdir('ys-fallback-dest-');
  try {
    const catalog = writeCatalog(home, [
      { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture' },
    ]);
    const env = makeEnv(home, catalog, {
      YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:9/',
      YOTTA_SKILLS_FETCH: 'auto',
      YOTTA_SKILLS_NPM: FAKE_NPM,
    });
    const r = runCli(['install', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'], env);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /拉包通道：内置失败/);
    const log = fs.readFileSync(path.join(home, '.yottaskills', 'install-log.jsonl'), 'utf8');
    assert.match(log, /"fetch_channel":"npm"/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('YOTTA_SKILLS_FETCH=builtin：禁用 npm 回退并给出明确报错', () => {
  const home = tmpdir('ys-builtin-only-home-');
  const dest = tmpdir('ys-builtin-only-dest-');
  try {
    const catalog = writeCatalog(home, [
      { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture' },
    ]);
    const env = makeEnv(home, catalog, {
      YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:9/',
      YOTTA_SKILLS_FETCH: 'builtin',
      YOTTA_SKILLS_NPM: FAKE_NPM,
    });
    const r = runCli(['install', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'], env);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /YOTTA_SKILLS_FETCH=builtin/);
    assert.ok(!fs.existsSync(path.join(dest, 'yotta-alpha')), '不应落位');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
