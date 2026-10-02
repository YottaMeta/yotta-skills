'use strict';
/**
 * --python 旗标回归（0.24.0 B.3 顺手修）：
 * 修复前 runScan 调用 findPython({})，--python 在该路径被忽略；
 * 用 node 作为 --python 候选（node --version 合法、node -B 必然报错）锁定旗标确实生效。
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

const SAFE_ENGINE = 'import json\nprint(json.dumps({"verdict": "SAFE TO INSTALL", "counts": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}}))\n';

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home) {
  const file = path.join(home, 'skills.json');
  fs.writeFileSync(file, JSON.stringify({
    manifestVersion: 1,
    updated: '2026-10-02',
    skills: [
      { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture' },
    ],
  }, null, 2) + '\n', 'utf8');
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

function hasPython() {
  return ['python3', 'python', 'py'].some((candidate) => {
    try {
      return spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0;
    } catch (_) {
      return false;
    }
  });
}

test('--python 旗标在扫描路径生效（回归：曾被 findPython({}) 忽略）', () => {
  const home = tmpdir('ys-pyflag-home-');
  const dest = tmpdir('ys-pyflag-dest-');
  try {
    const catalog = writeCatalog(home);
    const engine = path.join(home, 'yotta_verify.py');
    fs.writeFileSync(engine, SAFE_ENGINE, 'utf8');
    const r = runCli(
      ['install', 'yotta-alpha', '--dir', dest, '--verify', engine, '--python', process.execPath, '--no-reindex'],
      makeEnv(home, catalog),
    );
    assert.notStrictEqual(r.status, 0, 'node 不是 Python，扫描应失败：' + r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /bad option: -B/, '应证明 --python 指定的 node 真正被执行');
    assert.ok(!fs.existsSync(path.join(dest, 'yotta-alpha')), '扫描失败不应落位');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('对照组：--python 指向真实 Python 时扫描通过并安装成功', (t) => {
  if (!hasPython()) {
    t.skip('本机无 python');
    return;
  }
  const home = tmpdir('ys-pyok-home-');
  const dest = tmpdir('ys-pyok-dest-');
  try {
    const catalog = writeCatalog(home);
    const engine = path.join(home, 'yotta_verify.py');
    fs.writeFileSync(engine, SAFE_ENGINE, 'utf8');
    const python = ['python3', 'python', 'py'].find((candidate) => {
      try {
        return spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0;
      } catch (_) {
        return false;
      }
    });
    const r = runCli(
      ['install', 'yotta-alpha', '--dir', dest, '--verify', engine, '--python', python, '--no-reindex'],
      makeEnv(home, catalog),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /元信 scan: SAFE TO INSTALL/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
