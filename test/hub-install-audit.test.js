'use strict';
/**
 * 0.29.1 U3：hub install / update 补 Hub 审计回归。
 * 成功 / 失败各一条（slug / version / source / verdict / via / ok）；
 * skip / dry-run 不写；面板 /api/overview 可读到。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const viewLib = require('../lib/hub-view-server');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(__dirname, 'helpers', 'fake-npm.js');
const FAKE_VERIFY = path.join(__dirname, 'helpers', 'fake-verify.py');

const ALPHA = { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture alpha' };
const PANEL_HTML = '<!doctype html><html><head><meta name="robots" content="noindex"><meta name="yotta-view-token" content="__YOTTA_VIEW_TOKEN__"></head><body><h1>元阁 · 技能枢纽</h1></body></html>';

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home, name, skills) {
  const file = path.join(home, name);
  fs.writeFileSync(file, JSON.stringify({ manifestVersion: 1, updated: '2026-10-05', skills }, null, 2) + '\n', 'utf8');
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
  };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

function readAudit(hubDir) {
  const file = path.join(hubDir, '.yotta-hub-audit.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function installArgs(hubDir, extra) {
  return ['hub', 'install', '--only', 'yotta-alpha', '--hub', hubDir, '--verify', FAKE_VERIFY, '--no-reindex'].concat(extra || []);
}

test('hub install 成功 -> 写一条 install 审计（slug/version/source/via/verdict/ok）', () => {
  const home = tmpdir('ys-u3a-home-');
  const hubDir = tmpdir('ys-u3a-hub-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    const r = runCli(installArgs(hubDir), makeEnv(home, catalog, path.join(home, 'pack.log')));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const audit = readAudit(hubDir);
    assert.strictEqual(audit.length, 1, JSON.stringify(audit));
    assert.strictEqual(audit[0].event, 'install');
    assert.strictEqual(audit[0].slug, 'yotta-alpha');
    assert.strictEqual(audit[0].version, '0.1.0');
    assert.strictEqual(audit[0].source, 'npm');
    assert.strictEqual(audit[0].via, 'hub');
    assert.strictEqual(audit[0].ok, true);
    assert.strictEqual(audit[0].verdict, 'SAFE TO INSTALL');
    assert.ok(audit[0].at, '审计条目应带时间戳');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(hubDir, { recursive: true, force: true });
  }
});

test('hub update 成功 -> 写一条 update 审计（含升级后版本）', () => {
  const home = tmpdir('ys-u3u-home-');
  const hubDir = tmpdir('ys-u3u-hub-');
  try {
    const catalog1 = writeCatalog(home, 'skills-v1.json', [ALPHA]);
    const first = runCli(installArgs(hubDir), makeEnv(home, catalog1, path.join(home, 'pack1.log')));
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);
    fs.rmSync(path.join(hubDir, '.yotta-hub-audit.jsonl'), { force: true });

    const catalog2 = writeCatalog(home, 'skills-v2.json', [{ ...ALPHA, version: '0.1.1' }]);
    const r = runCli(
      ['hub', 'update', '--only', 'yotta-alpha', '--hub', hubDir, '--verify', FAKE_VERIFY, '--no-reindex'],
      makeEnv(home, catalog2, path.join(home, 'pack2.log')),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const audit = readAudit(hubDir);
    assert.strictEqual(audit.length, 1, JSON.stringify(audit));
    assert.strictEqual(audit[0].event, 'update');
    assert.strictEqual(audit[0].slug, 'yotta-alpha');
    assert.strictEqual(audit[0].version, '0.1.1');
    assert.strictEqual(audit[0].ok, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(hubDir, { recursive: true, force: true });
  }
});

test('hub install 失败（门禁拦截）-> 写一条 ok:false 审计', () => {
  const home = tmpdir('ys-u3f-home-');
  const hubDir = tmpdir('ys-u3f-hub-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    const env = Object.assign(makeEnv(home, catalog, path.join(home, 'pack.log')), {
      YOTTA_SKILLS_FAKE_VERDICT: 'DO NOT INSTALL',
    });
    const r = runCli(installArgs(hubDir), env);
    assert.strictEqual(r.status, 5, r.stdout + r.stderr);
    const audit = readAudit(hubDir);
    assert.strictEqual(audit.length, 1, JSON.stringify(audit));
    assert.strictEqual(audit[0].event, 'install');
    assert.strictEqual(audit[0].ok, false);
    assert.match(String(audit[0].error), /DO NOT INSTALL|verdict/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(hubDir, { recursive: true, force: true });
  }
});

test('hub install 已是最新 -> skip 不写审计', () => {
  const home = tmpdir('ys-u3s-home-');
  const hubDir = tmpdir('ys-u3s-hub-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    const env = makeEnv(home, catalog, path.join(home, 'pack.log'));
    const first = runCli(installArgs(hubDir), env);
    assert.strictEqual(first.status, 0, first.stdout + first.stderr);
    assert.strictEqual(readAudit(hubDir).length, 1);
    const second = runCli(installArgs(hubDir), env);
    assert.strictEqual(second.status, 0, second.stdout + second.stderr);
    assert.strictEqual(readAudit(hubDir).length, 1, 'skip 不应新增审计条目');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(hubDir, { recursive: true, force: true });
  }
});

test('hub install --dry-run -> 不写审计', () => {
  const home = tmpdir('ys-u3d-home-');
  const hubDir = tmpdir('ys-u3d-hub-');
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    const r = runCli(
      ['hub', 'install', '--dry-run', '--only', 'yotta-alpha', '--hub', hubDir, '--no-reindex'],
      makeEnv(home, catalog, path.join(home, 'pack.log')),
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(readAudit(hubDir).length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(hubDir, { recursive: true, force: true });
  }
});

test('面板 /api/overview 可读到 hub install 审计条目', async () => {
  const home = tmpdir('ys-u3v-home-');
  const hubDir = tmpdir('ys-u3v-hub-');
  let view = null;
  try {
    const catalog = writeCatalog(home, 'skills.json', [ALPHA]);
    const r = runCli(installArgs(hubDir), makeEnv(home, catalog, path.join(home, 'pack.log')));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);

    view = viewLib.createHubViewServer({
      hubDir,
      homeDir: home,
      env: makeEnv(home),
      manifest: [ALPHA],
      version: '0.29.1-test',
      token: 'test-token',
      html: PANEL_HTML,
    });
    await new Promise((resolve, reject) => {
      view.server.once('error', reject);
      view.server.listen(0, '127.0.0.1', resolve);
    });
    const port = view.server.address().port;
    const payload = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/overview' }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
        });
      }).on('error', reject);
    });
    assert.ok(Array.isArray(payload.audit && payload.audit.recent), 'overview 应含 audit.recent');
    assert.ok(
      payload.audit.recent.some((item) => item.event === 'install' && item.slug === 'yotta-alpha' && item.via === 'hub'),
      JSON.stringify(payload.audit.recent),
    );
  } finally {
    if (view) await view.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(hubDir, { recursive: true, force: true });
  }
});
