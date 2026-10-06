'use strict';
/**
 * 0.29.5 S4：元信自举落点 = 运行时缓存（<记录根>/runtime/verifier），
 * 不再写进 --dir 目标目录；目标目录保持干净（无 yotta-verify / .yottaskills-staging）。
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

const ALPHA = { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.1', domain: 'security', desc: 'fixture alpha' };
const VERIFY = { slug: 'yotta-verify', name: '元信', pkg: '@yottameta/yotta-verify', version: '0.3.9', domain: 'security', desc: 'fixture verifier' };

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home, name, skills) {
  const file = path.join(home, name);
  fs.writeFileSync(file, JSON.stringify({ manifestVersion: 1, updated: '2026-10-06', skills }, null, 2) + '\n', 'utf8');
  return file;
}

function makeEnv(home, catalog, log) {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
    YOTTA_SKILLS_MANIFEST: catalog,
    YOTTA_SKILLS_FAKE_CATALOG: catalog,
    YOTTA_SKILLS_NPM: FAKE_NPM,
    YOTTA_SKILLS_FETCH: 'npm',
    YOTTA_SKILLS_FAKE_LOG: log,
    YOTTA_SKILLS_REGISTRY_FILE: path.join(home, '.yottaskills', 'registry.json'),
  };
}

test('update --dir self-bootstraps the verifier into the runtime cache, not the target dir', () => {
  const home = tmpdir('ys-boot-home-');
  const targetDir = tmpdir('ys-boot-target-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA, VERIFY]);
    const alphaDir = path.join(targetDir, ALPHA.slug);
    fs.mkdirSync(alphaDir, { recursive: true });
    fs.writeFileSync(path.join(alphaDir, 'SKILL.md'),
      '---\nname: yotta-alpha\nversion: 0.1.0\n---\n', 'utf8');

    const r = spawnSync(process.execPath, [
      BIN, 'update', '--installed-only', '--dir', targetDir, '--range',
      '--only', 'yotta-alpha', '--no-reindex', '--json',
    ], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, ...makeEnv(home, catalog, path.join(home, 'pack.log')) },
    });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);

    // 目标目录保持干净：只有被更新的技能，没有元信 / 暂存。
    assert.ok(fs.existsSync(path.join(alphaDir, 'SKILL.md')));
    assert.match(fs.readFileSync(path.join(alphaDir, 'SKILL.md'), 'utf8'), /0\.1\.1/);
    assert.ok(!fs.existsSync(path.join(targetDir, 'yotta-verify')), 'verifier must not land in the target dir');
    assert.ok(!fs.existsSync(path.join(targetDir, '.yottaskills-staging')), 'staging must not remain in the target dir');

    // 自举产物 + 受信记录都在运行时缓存根。
    const cacheEngine = path.join(home, '.yottaskills', 'runtime', 'verifier', 'yotta-verify', 'scripts', 'yotta_verify.py');
    assert.ok(fs.existsSync(cacheEngine), 'verifier must be cached at ' + cacheEngine);
    const recordFile = path.join(home, '.yottaskills', 'trusted-verifier.json');
    assert.ok(fs.existsSync(recordFile), 'trusted record must be written');
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    assert.strictEqual(path.resolve(record.path), path.resolve(cacheEngine));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('the cached verifier is reused on the next --dir update (no second download of the verifier)', () => {
  const home = tmpdir('ys-boot-reuse-');
  const targetDir = tmpdir('ys-boot-reuse-target-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA, VERIFY]);
    const alphaDir = path.join(targetDir, ALPHA.slug);
    fs.mkdirSync(alphaDir, { recursive: true });
    fs.writeFileSync(path.join(alphaDir, 'SKILL.md'),
      '---\nname: yotta-alpha\nversion: 0.1.0\n---\n', 'utf8');
    const env = makeEnv(home, catalog, path.join(home, 'pack.log'));

    const first = spawnSync(process.execPath, [
      BIN, 'update', '--installed-only', '--dir', targetDir, '--range', '--only', 'yotta-alpha', '--no-reindex',
    ], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, ...env } });
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);

    // 第二次：把已装版本改成旧版，重跑更新；日志里不应再出现元信的 pack。
    fs.writeFileSync(path.join(alphaDir, 'SKILL.md'),
      '---\nname: yotta-alpha\nversion: 0.1.0\n---\n', 'utf8');
    fs.writeFileSync(path.join(home, 'pack.log'), '', 'utf8');
    const second = spawnSync(process.execPath, [
      BIN, 'update', '--installed-only', '--dir', targetDir, '--range', '--only', 'yotta-alpha', '--no-reindex',
    ], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, ...env } });
    assert.strictEqual(second.status, 0, second.stdout + second.stderr);
    const packs = fs.readFileSync(path.join(home, 'pack.log'), 'utf8').trim().split(/\r?\n/).filter(Boolean);
    const verifierPacks = packs.filter((line) => line.includes('yotta-verify'));
    assert.deepStrictEqual(verifierPacks, [], 'cached verifier must be reused: ' + packs.join(' | '));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});
