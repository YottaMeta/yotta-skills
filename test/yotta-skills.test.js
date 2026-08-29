'use strict';
/**
 * yotta-skills CLI 测试（离线）：--list / --version / --dry-run / 安装到临时目录断言。
 * 用 test/helpers/fake-npm.js 拦截 npm pack，不联网。
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
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.json'), 'utf8'));
const skills = Array.isArray(manifest) ? manifest : manifest.skills;
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(args, env, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8', cwd: cwd || ROOT,
    env: { ...process.env, ...(env || {}) },
  });
}
function fakeEnv(extra) {
  return { YOTTA_SKILLS_NPM: FAKE_NPM, ...(extra || {}) };
}
function tmpdir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function logPath() { return path.join(tmpdir('ys-log-'), 'npm.log'); }
function readLog(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean);
}

test('--list 列出全部 22 技能 + 版本 + 说明', () => {
  const r = run(['--list']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /全家技能清单（22 个）/);
  for (const s of skills) {
    assert.ok(r.stdout.includes(s.slug), '缺 slug: ' + s.slug);
    assert.ok(r.stdout.includes(s.version), '缺版本 ' + s.version + ' : ' + s.slug);
    assert.ok(r.stdout.includes(s.name), '缺中文名: ' + s.name);
    assert.ok(r.stdout.includes(s.pkg + '@'), '缺 pkg: ' + s.pkg);
  }
});

test('--version 与 package.json 一致', () => {
  const r = run(['--version']);
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes('yotta-skills v' + PKG.version));
});

test('--dry-run 不联网不改动，列出全部', () => {
  const r = run(['--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry-run/);
  for (const s of skills) assert.ok(r.stdout.includes(s.slug), '缺 ' + s.slug);
  assert.match(r.stdout, /未执行任何下载\/写入/);
});

test('install --dry-run --dir 显示目标路径', () => {
  const dest = tmpdir('ys-dr-');
  const r = run(['install', '--dry-run', '--dir', dest]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(dest));
});

test('install 全家到临时目录：22 个 SKILL.md 落位 + skip 集合 + range spec', () => {
  const dest = tmpdir('ys-install-');
  const log = logPath();
  const r = run(['install', '--dir', dest, '--skip-scan'], fakeEnv({ YOTTA_SKILLS_FAKE_LOG: log }));
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const s of skills) {
    const dir = path.join(dest, s.slug);
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), '缺 SKILL.md: ' + s.slug);
    assert.ok(fs.existsSync(path.join(dir, 'assets', 'marker.txt')), '缺 marker: ' + s.slug);
    assert.ok(!fs.existsSync(path.join(dir, 'package.json')), 'package.json 不应复制: ' + s.slug);
    assert.ok(!fs.existsSync(path.join(dir, 'bin')), 'bin 不应复制: ' + s.slug);
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', '__pycache__')), '__pycache__ 不应复制: ' + s.slug);
    assert.ok(!fs.existsSync(path.join(dir, 'stray.pyc')), '*.pyc 不应复制: ' + s.slug);
    const marker = fs.readFileSync(path.join(dir, 'assets', 'marker.txt'), 'utf8');
    assert.ok(marker.includes(s.slug) && marker.includes(s.version), 'marker 内容: ' + s.slug);
  }
  // range spec：日志记录 @major.x（不锁 patch）
  const lines = readLog(log);
  assert.strictEqual(lines.length, skills.length, 'pack 调用数');
  for (const s of skills) {
    const major = s.version.split('.')[0];
    assert.ok(lines.some(l => l.includes(s.pkg + '@' + major + '.x')), 'range spec 缺失: ' + s.pkg);
  }
  assert.match(r.stdout, /汇总: 成功 22 \/ 跳过\(已是最新\) 0 \/ 失败 0/);
});

test('install 幂等：第二次全部跳过（不再 pack）', () => {
  const dest = tmpdir('ys-idem-');
  const log1 = logPath();
  const r1 = run(['install', '--dir', dest, '--skip-scan'], fakeEnv({ YOTTA_SKILLS_FAKE_LOG: log1 }));
  assert.strictEqual(r1.status, 0, r1.stdout + r1.stderr);
  const log2 = logPath();
  const r2 = run(['install', '--dir', dest, '--skip-scan'], fakeEnv({ YOTTA_SKILLS_FAKE_LOG: log2 }));
  assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /汇总: 成功 0 \/ 跳过\(已是最新\) 22 \/ 失败 0/);
  assert.strictEqual(readLog(log2).length, 0, '第二次不应触发 pack');
});

test('install 单个 + --pin 用精确版本', () => {
  const dest = tmpdir('ys-pin-');
  const log = logPath();
  const r = run(['install', 'yotta-memory', '--dir', dest, '--pin', '--skip-scan'], fakeEnv({ YOTTA_SKILLS_FAKE_LOG: log }));
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(dest, 'yotta-memory', 'SKILL.md')));
  const lines = readLog(log);
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].includes('@yottameta/yotta-memory@0.8.4'), 'pin 应传精确版本: ' + lines[0]);
});

test('update：删除一个技能后补齐，其余跳过', () => {
  const dest = tmpdir('ys-upd-');
  const r1 = run(['install', '--dir', dest, '--skip-scan'], fakeEnv({ YOTTA_SKILLS_FAKE_LOG: logPath() }));
  assert.strictEqual(r1.status, 0, r1.stdout + r1.stderr);
  fs.rmSync(path.join(dest, 'yotta-memory'), { recursive: true, force: true });
  const r2 = run(['update', '--dir', dest, '--skip-scan'], fakeEnv({ YOTTA_SKILLS_FAKE_LOG: logPath() }));
  assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
  assert.ok(fs.existsSync(path.join(dest, 'yotta-memory', 'SKILL.md')), 'update 应补齐缺失技能');
  assert.match(r2.stdout, /汇总: 更新 1 \/ 已是最新 21 \/ 失败 0/);
});

test('未知智能体 -> 退出码 2 且提示', () => {
  const r = run(['install', '--agent', 'bogus-agent']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /未收录智能体/);
});

test('未知技能 -> 退出码 2 且提示', () => {
  const r = run(['install', 'not-a-skill', '--dir', tmpdir('ys-unk-')]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /未知技能/);
});

test('install 无目标且无项目级目录 -> 退出码 4', () => {
  const cwd = tmpdir('ys-nodir-');
  const r = spawnSync(process.execPath, [BIN, 'install'], { encoding: 'utf8', cwd });
  assert.strictEqual(r.status, 4);
  assert.match(r.stderr, /未指定目标/);
});

test('元信 scan 集成：--verify 指定引擎时输出装前摘要', (t) => {
  const pyOk = ['python3', 'python', 'py'].some(c => {
    try { return spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0; } catch (_) { return false; }
  });
  if (!pyOk) { t.skip('本机无 python'); return; }
  const dest = tmpdir('ys-scan-');
  const engine = path.join(tmpdir('ys-eng-'), 'yotta_verify.py');
  fs.writeFileSync(engine, 'import sys,json\nprint(json.dumps({"verdict":"SAFE TO INSTALL","counts":{"critical":0,"high":0,"medium":0,"low":1,"info":2}}))\n', 'utf8');
  const r = run(['install', 'yotta-verify', '--dir', dest, '--verify', engine], fakeEnv());
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /元信 scan: SAFE TO INSTALL/);
});
