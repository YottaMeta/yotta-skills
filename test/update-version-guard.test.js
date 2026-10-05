'use strict';
/**
 * 0.29.1 U1：update「只升不降」四路径回归。
 * 覆盖：update / update --check / update --auto / hub update，
 * 以及 --force 显式降级、dry-run 本地领先预览、local-ahead 零网络。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(__dirname, 'helpers', 'fake-npm.js');

const ALPHA = { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture alpha' };

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home, name, skills) {
  const file = path.join(home, name);
  fs.writeFileSync(file, JSON.stringify({ manifestVersion: 1, updated: '2026-10-05', skills }, null, 2) + '\n', 'utf8');
  return file;
}

function writeSkill(dir, slug, version, name) {
  const d = path.join(dir, slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'),
    '---\nname: ' + (name || slug) + '\nversion: ' + version + '\ndescription: test\n---\n# ' + slug + '\n', 'utf8');
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

/** update --check / --auto 走本地 HTTP registry，必须异步 spawn（同步会阻塞同进程 server）。 */
function runAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = '', stderr = '', done = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill('SIGKILL'); } catch (_) {} resolve({ status: null, signal: 'TIMEOUT', stdout, stderr }); }
    }, 20000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code, signal) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

function startRegistry(versions) {
  const server = http.createServer((req, res) => {
    server.requests++;
    const pkg = decodeURIComponent(req.url.replace(/^\//, ''));
    if (versions[pkg] === undefined) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: pkg, 'dist-tags': { latest: versions[pkg] } }));
  });
  server.requests = 0;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function free(server) {
  return new Promise((resolve) => server.close(resolve));
}

function readVersion(dest, slug) {
  const text = fs.readFileSync(path.join(dest, slug, 'SKILL.md'), 'utf8');
  return (text.match(/^version:\s*([^\s]+)/m) || [])[1] || null;
}

function readLog(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean);
}

test('update：本地领先 -> 跳过保留，不降级、不发网络（退出码 0）', () => {
  const home = tmpdir('ys-u1-home-');
  const dest = tmpdir('ys-u1-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    writeSkill(dest, 'yotta-alpha', '0.2.0');
    const log = path.join(home, 'pack.log');
    const r = runCli(['update', '--dir', dest, '--no-reindex'], makeEnv(home, catalog, log));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /本地领先 v0\.2\.0 > 目标 v0\.1\.0/);
    assert.match(r.stdout, /保留不降级/);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.2.0');
    assert.strictEqual(readLog(log).length, 0, 'local-ahead 不得调用 npm');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('update --force：本地领先 -> 显式降级通道仍可用', () => {
  const home = tmpdir('ys-u1f-home-');
  const dest = tmpdir('ys-u1f-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    writeSkill(dest, 'yotta-alpha', '0.2.0');
    const log = path.join(home, 'pack.log');
    const r = runCli(['update', '--force', '--skip-scan', '--dir', dest, '--no-reindex'], makeEnv(home, catalog, log));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.1.0');
    assert.ok(readLog(log).length >= 1, '--force 应走安装管线');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('update --check：本地领先 -> localAhead、退出码 0、不计更新（含 --json）', async () => {
  const server = await startRegistry({ '@fake/alpha': '0.1.0' });
  const home = tmpdir('ys-u1c-home-');
  const dest = tmpdir('ys-u1c-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    writeSkill(dest, 'yotta-alpha', '0.2.0');
    const env = Object.assign(makeEnv(home, catalog, path.join(home, 'pack.log')), {
      YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/',
    });
    const r = await runAsync(['update', '--check', '--dir', dest], env);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /本地领先：本地 v0\.2\.0 > 最新 v0\.1\.0/);
    assert.match(r.stdout, /汇总: 有更新 0 \/ 本地领先 1 \/ 已最新 0 \/ 检查失败 0 \/ 非家族跳过 0/);

    const rj = await runAsync(['update', '--check', '--json', '--dir', dest], env);
    assert.strictEqual(rj.status, 0, rj.stdout + rj.stderr);
    const j = JSON.parse(rj.stdout);
    assert.strictEqual(j.localAhead, 1);
    assert.strictEqual(j.updates, 0);
    assert.strictEqual(j.updatable.length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    await free(server);
  }
});

test('update --auto：本地领先 -> 不自动安装（不发 npm pack）', async () => {
  const server = await startRegistry({ '@fake/alpha': '0.1.0' });
  const home = tmpdir('ys-u1a-home-');
  const dest = tmpdir('ys-u1a-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    writeSkill(dest, 'yotta-alpha', '0.2.0');
    const log = path.join(home, 'pack.log');
    const env = Object.assign(makeEnv(home, catalog, log), {
      YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/',
    });
    const r = await runAsync(['update', '--auto', '--dir', dest, '--no-reindex'], env);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /本地领先 1 个（保留不降级）/);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.2.0');
    assert.strictEqual(readLog(log).length, 0, 'local-ahead 不得调用 npm');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    await free(server);
  }
});

test('update --auto：真更新 -> 正常安装（回归，不带 force）', async () => {
  const server = await startRegistry({ '@fake/alpha': '0.1.1' });
  const home = tmpdir('ys-u1u-home-');
  const dest = tmpdir('ys-u1u-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [{ ...ALPHA, version: '0.1.1' }]);
    writeSkill(dest, 'yotta-alpha', '0.1.0');
    const log = path.join(home, 'pack.log');
    const env = Object.assign(makeEnv(home, catalog, log), {
      YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/',
    });
    const r = await runAsync(
      ['update', '--auto', '--dir', dest, '--no-reindex', '--verify', path.join(ROOT, 'test', 'helpers', 'fake-verify.py')],
      env,
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.1.1');
    assert.ok(readLog(log).length >= 1, '真更新应走安装管线');
    assert.match(r.stdout, /自动更新汇总: 成功 1 \/ 失败 0/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    await free(server);
  }
});

test('hub update：Hub 本地领先 -> 跳过保留、不发网络', () => {
  const home = tmpdir('ys-u1h-home-');
  const hubDir = tmpdir('ys-u1h-hub-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    writeSkill(hubDir, 'yotta-alpha', '0.2.0');
    const log = path.join(home, 'pack.log');
    const r = runCli(['hub', 'update', '--only', 'yotta-alpha', '--hub', hubDir, '--no-reindex'], makeEnv(home, catalog, log));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /本地领先 v0\.2\.0 > 目标 v0\.1\.0/);
    assert.strictEqual(readVersion(hubDir, 'yotta-alpha'), '0.2.0');
    assert.strictEqual(readLog(log).length, 0, 'hub update local-ahead 不得调用 npm');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(hubDir, { recursive: true, force: true });
  }
});

test('update --dry-run：本地领先 -> 预览标注「保留不降级」，零网络', () => {
  const home = tmpdir('ys-u1d-home-');
  const dest = tmpdir('ys-u1d-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    writeSkill(dest, 'yotta-alpha', '0.2.0');
    const log = path.join(home, 'pack.log');
    const r = runCli(['update', '--dry-run', '--dir', dest], makeEnv(home, catalog, log));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[本地领先\]/);
    assert.match(r.stdout, /保留不降级：v0\.2\.0 > v0\.1\.0/);
    assert.strictEqual(readVersion(dest, 'yotta-alpha'), '0.2.0');
    assert.strictEqual(readLog(log).length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
