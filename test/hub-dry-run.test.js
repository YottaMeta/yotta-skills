'use strict';
/**
 * 0.29.0 D1：hub install / update --dry-run 必须真正只读
 * （无网络、无写入、Hub 目录与台账逐字节不变）。
 *
 * 回归背景：0.28.3 实测 hub install --dry-run 会真实联网安装特殊家族并写 Hub 台账
 * （logs 2026-10-04 §四）。修复要求：dryRun 透传到安装管线，预览不发网络请求、
 * 不写任何文件；--json 输出机器可读 plan。
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(ROOT, 'test', 'helpers', 'fake-npm.js');
// 与清单 pin 动态对齐（元忆升版不再改测试字面量）。
const MANIFEST = require(path.join(ROOT, 'skills.json'));
const MEMORY_PIN = MANIFEST.skills.find((s) => s.slug === 'yotta-memory').version;

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
}

function fakeHomeEnv(home, logFile) {
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
    YOTTA_SKILLS_FAKE_LOG: logFile,
  };
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

/** 目录快照：相对路径 + mtime + size + 类型（dry-run 后必须逐项一致）。 */
function snapshotTree(dir) {
  const lines = [];
  const walk = (current) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const st = fs.lstatSync(full);
      lines.push(path.relative(dir, full) + '|' + st.mtimeMs + '|' + st.size + '|' + (st.isDirectory() ? 'd' : 'f'));
      if (st.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return lines.join('\n');
}

const STATE_BYTES = JSON.stringify({
  standard: 'yotta-skills-hub/v1',
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  skills: {},
}, null, 2) + '\n';

test('hub install --dry-run：无网络 / 无写入 / 台账逐字节不变（--json plan）', () => {
  const home = tmp('ys-dryrun-install-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-memory'), 'yotta-memory', '0.0.1');
    const stateFile = path.join(hubDir, '.yotta-hub.json');
    fs.writeFileSync(stateFile, STATE_BYTES, 'utf8');
    const logFile = path.join(home, 'fake-npm.log');
    const env = fakeHomeEnv(home, logFile);
    const before = snapshotTree(hubDir);

    const result = run([
      'hub', 'install', '--dry-run', '--json', '--only', 'yotta-memory',
      '--hub', hubDir, '--npm', FAKE_NPM,
    ], env);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.dryRun, true);
    assert.strictEqual(payload.action, 'install');
    assert.strictEqual(payload.summary.planned, 1);
    assert.strictEqual(payload.summary.failed, 0);
    const item = payload.skills.find((entry) => entry.slug === 'yotta-memory');
    assert.ok(item, 'plan 必须包含 yotta-memory');
    assert.strictEqual(item.planned, 'update');
    assert.strictEqual(item.installedVersion, '0.0.1');
    assert.strictEqual(item.version, MEMORY_PIN);

    assert.strictEqual(fs.existsSync(logFile), false, 'dry-run 不得调用 npm（联网）');
    assert.strictEqual(snapshotTree(hubDir), before, 'dry-run 不得改动 Hub 目录（含 mtime）');
    assert.strictEqual(fs.readFileSync(stateFile, 'utf8'), STATE_BYTES, '台账必须逐字节不变');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub update --dry-run：计划输出 + 无写入（含缺失技能补装计划）', () => {
  const home = tmp('ys-dryrun-update-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-memory'), 'yotta-memory', '0.0.1');
    const logFile = path.join(home, 'fake-npm.log');
    const env = fakeHomeEnv(home, logFile);
    const before = snapshotTree(hubDir);

    const result = run([
      'hub', 'update', '--dry-run', '--json', '--only', 'yotta-memory',
      '--hub', hubDir, '--npm', FAKE_NPM,
    ], env);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'update');
    assert.strictEqual(payload.summary.planned, 1);
    const item = payload.skills.find((entry) => entry.slug === 'yotta-memory');
    assert.strictEqual(item.planned, 'update');
    assert.strictEqual(item.installedVersion, '0.0.1');

    assert.strictEqual(fs.existsSync(logFile), false, 'dry-run 不得调用 npm（联网）');
    assert.strictEqual(snapshotTree(hubDir), before, 'dry-run 不得改动 Hub 目录');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub install --dry-run：已是最新的技能计划为 skip，文本模式给只读提示', () => {
  const home = tmp('ys-dryrun-skip-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-memory'), 'yotta-memory', MEMORY_PIN);
    const logFile = path.join(home, 'fake-npm.log');
    const env = fakeHomeEnv(home, logFile);

    const jsonRun = run([
      'hub', 'install', '--dry-run', '--json', '--only', 'yotta-memory',
      '--hub', hubDir, '--npm', FAKE_NPM,
    ], env);
    assert.strictEqual(jsonRun.status, 0, jsonRun.stderr);
    const payload = JSON.parse(jsonRun.stdout);
    assert.strictEqual(payload.summary.planned, 0);
    assert.strictEqual(payload.summary.skip, 1);

    const textRun = run([
      'hub', 'install', '--dry-run', '--only', 'yotta-memory',
      '--hub', hubDir, '--npm', FAKE_NPM,
    ], env);
    assert.strictEqual(textRun.status, 0, textRun.stderr);
    assert.match(textRun.stdout, /dry-run/);
    assert.match(textRun.stdout, /台账未更新|未执行任何下载/);
    assert.strictEqual(fs.existsSync(logFile), false, 'dry-run 不得调用 npm');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('顶层 install --dry-run（非 hub）行为不回退', () => {
  const home = tmp('ys-dryrun-top-');
  try {
    const logFile = path.join(home, 'fake-npm.log');
    const env = fakeHomeEnv(home, logFile);
    const result = run([
      'install', '--dry-run', '--agent', 'codex', '--only', 'yotta-memory', '--npm', FAKE_NPM,
    ], env);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /dry-run/);
    assert.strictEqual(fs.existsSync(path.join(home, '.codex', 'skills')), false,
      'dry-run 不得创建目标目录');
    assert.strictEqual(fs.existsSync(logFile), false, 'dry-run 不得调用 npm');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
