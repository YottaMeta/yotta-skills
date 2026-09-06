'use strict';
/**
 * yotta-skills update --check / --auto 更新检查测试（本地 HTTP registry，不联网）。
 * 注意：必须用异步 spawn——spawnSync 会阻塞父进程事件循环，导致同进程内起
 * 的本地 HTTP registry 无法响应子进程请求，从而挂起（曾因此卡死 15s）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(__dirname, 'helpers', 'fake-npm.js');
const RUN_TIMEOUT = 20000;

function startRegistry(versions) {
  const server = http.createServer((req, res) => {
    const pkg = decodeURIComponent(req.url.replace(/^\//, ''));
    if (versions[pkg] === undefined) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: pkg, 'dist-tags': { latest: versions[pkg] } }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function free(server) { return new Promise((resolve) => server.close(resolve)); }
function run(args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: cwd || ROOT, env: { ...process.env, ...(env || {}) } });
    let stdout = '', stderr = '', done = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill('SIGKILL'); } catch (_) {} resolve({ status: null, signal: 'TIMEOUT', stdout, stderr }); }
    }, RUN_TIMEOUT);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code, signal) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}
function tmpdir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function writeSkill(dir, slug, version, name) {
  const d = path.join(dir, slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: ' + (name || slug) + '\nversion: ' + version + '\ndescription: test\n---\n# ' + slug + '\n', 'utf8');
}

test('update --check：家族技能有更新 -> 退出码 3 且报告', async () => {
  const server = await startRegistry({ '@yottameta/yotta-memory': '0.11.0', '@yottameta/yotta-present': '0.5.0' });
  const dest = tmpdir('ys-check-upd-');
  try {
    writeSkill(dest, 'yotta-memory', '0.10.0');
    writeSkill(dest, 'yotta-present', '0.5.0');
    writeSkill(dest, 'some-other', '1.0.0');
    const r = await run(['update', '--check', '--dir', dest], { YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/' });
    assert.strictEqual(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /检查更新（只读/);
    assert.match(r.stdout, /yotta-memory/);
    assert.match(r.stdout, /有更新：本地 v0\.10\.0 -> 最新 v0\.11\.0/);
    assert.match(r.stdout, /yotta-present/);
    assert.match(r.stdout, /已最新（本地 v0\.5\.0）/);
    assert.match(r.stdout, /非元阁家族，跳过/);
    assert.match(r.stdout, /汇总: 有更新 1 \/ 已最新 1 \/ 检查失败 0 \/ 非家族跳过 1/);
  } finally { fs.rmSync(dest, { recursive: true, force: true }); await free(server); }
});

test('update --check：全部最新 -> 退出码 0', async () => {
  const server = await startRegistry({ '@yottameta/yotta-memory': '0.11.0' });
  const dest = tmpdir('ys-check-ok-');
  try {
    writeSkill(dest, 'yotta-memory', '0.11.0');
    const r = await run(['update', '--check', '--dir', dest], { YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /已最新（本地 v0\.11\.0）/);
    assert.match(r.stdout, /汇总: 有更新 0 \/ 已最新 1 \/ 检查失败 0 \/ 非家族跳过 0/);
  } finally { fs.rmSync(dest, { recursive: true, force: true }); await free(server); }
});

test('update --check --json：输出可解析 JSON 结构', async () => {
  const server = await startRegistry({ '@yottameta/yotta-memory': '0.11.0' });
  const dest = tmpdir('ys-check-json-');
  try {
    writeSkill(dest, 'yotta-memory', '0.10.0');
    const r = await run(['update', '--check', '--json', '--dir', dest], { YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/' });
    assert.strictEqual(r.status, 3, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.strictEqual(j.dest, dest);
    assert.strictEqual(j.updates, 1);
    assert.strictEqual(j.updatable.length, 1);
    assert.strictEqual(j.updatable[0].slug, 'yotta-memory');
    assert.strictEqual(j.updatable[0].latest, '0.11.0');
  } finally { fs.rmSync(dest, { recursive: true, force: true }); await free(server); }
});

test('update --check：registry 查询失败 -> 退出码 1 且不误报有更新', async () => {
  const server = await startRegistry({});
  const dest = tmpdir('ys-check-fail-');
  try {
    writeSkill(dest, 'yotta-memory', '0.10.0');
    const r = await run(['update', '--check', '--dir', dest], { YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /检查失败/);
  } finally { fs.rmSync(dest, { recursive: true, force: true }); await free(server); }
});

test('update --auto：检查到家族更新后本地更新（仅自家家族，含装前管线）', async () => {
  const server = await startRegistry({ '@yottameta/yotta-memory': '0.11.0' });
  const dest = tmpdir('ys-auto-');
  const home = tmpdir('ys-auto-home-');
  try {
    writeSkill(dest, 'yotta-memory', '0.10.0');
    const r = await run(['update', '--auto', '--dir', dest, '--skip-scan'],
      { YOTTA_SKILLS_REGISTRY: 'http://127.0.0.1:' + server.address().port + '/', YOTTA_SKILLS_NPM: FAKE_NPM,
        USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex'), XDG_CONFIG_HOME: path.join(home, '.config') });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const updated = fs.readFileSync(path.join(dest, 'yotta-memory', 'SKILL.md'), 'utf8');
    assert.match(updated, /version: 0\.11\.0/);
    assert.match(r.stdout, /自动更新汇总: 成功 1 \/ 失败 0/);
  } finally { fs.rmSync(dest, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); await free(server); }
});