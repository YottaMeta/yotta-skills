'use strict';
/**
 * 0.30.0 面板 UX/OPT 回归：
 * - OPT-03：/api/hosts「指向当前 Hub」以文件系统为真源，其它 Hub 链接单独计数（错位预警）
 * - UX-08：/api/hosts/rename 一步改名（token 门禁 + 只改 label + 审计）
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const viewLib = require('../lib/hub-view-server');

const TOKEN = 'test-view-token-030';
const PANEL_HTML = '<!doctype html><html><head><meta name="robots" content="noindex"><meta name="yotta-view-token" content="__YOTTA_VIEW_TOKEN__"></head><body><h1>元阁 · 技能枢纽</h1></body></html>';

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  const target = path.join(dir, slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
  return target;
}

function writeHubMarker(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.yotta-hub.json'),
    JSON.stringify({ standard: 'yotta-skills-hub/v1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', skills: {} }, null, 2) + '\n');
}

function makeEnv(home) {
  return {
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
    XDG_DATA_HOME: path.join(home, '.data'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
  };
}

function linkDir(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(path.resolve(target), linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function request(port, method, target, options) {
  const opts = options || {};
  const body = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: target,
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
        ...(opts.headers || {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* keep null */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function withServer(home, fn) {
  const hubDir = path.join(home, '.yottaskills', 'hub');
  fs.mkdirSync(hubDir, { recursive: true });
  const view = viewLib.createHubViewServer({
    hubDir,
    homeDir: home,
    env: makeEnv(home),
    manifest: [],
    version: '0.30.0-test',
    token: TOKEN,
    html: PANEL_HTML,
  });
  await new Promise((resolve, reject) => {
    view.server.once('error', reject);
    view.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await fn(view, view.server.address().port, hubDir);
  } finally {
    await view.close();
  }
}

function auth() {
  return { [viewLib.TOKEN_HEADER]: TOKEN };
}

test('OPT-03：/api/hosts 指向当前 Hub 以文件系统为真源，其它 Hub 链接单独计数', async () => {
  const home = tmp('ys-ux030-view-hosts-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(hubDir, 'alpha', '1.0.0');
    writeHubMarker(hubDir);
    const oldHub = path.join(home, 'old-hub');
    writeSkill(oldHub, 'alpha', '1.0.0');
    writeHubMarker(oldHub);
    const host = path.join(home, 'host-skills');
    linkDir(path.join(oldHub, 'alpha'), path.join(host, 'alpha'));

    await withServer(home, async (view, port) => {
      let r = await request(port, 'POST', '/api/hosts/add', {
        headers: auth(), body: { dir: host, label: '测试宿主' },
      });
      assert.strictEqual(r.status, 200, r.text);

      r = await request(port, 'GET', '/api/hosts');
      assert.strictEqual(r.status, 200, r.text);
      const hostRow = (r.json.hosts || []).find((item) =>
        path.resolve(item.dir).toLowerCase() === path.resolve(host).toLowerCase());
      assert.ok(hostRow, 'registered host must be discovered: ' + JSON.stringify(r.json.hosts));
      assert.strictEqual(hostRow.hubLinks, 0, '当前 Hub 链接应为 0（fs 真源）');
      assert.strictEqual(hostRow.hubLinksOther, 1, '其它 Hub 链接应计数 1');
      assert.strictEqual(hostRow.hubLinksOtherRoots.length, 1);
      assert.ok(path.resolve(hostRow.hubLinksOtherRoots[0]).toLowerCase() === path.resolve(oldHub).toLowerCase());
      assert.strictEqual(r.json.summary.otherHubLinks, 1);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('UX-08：/api/hosts/rename token 门禁 + 一步改名 + 审计', async () => {
  const home = tmp('ys-ux030-view-rename-');
  try {
    const host = path.join(home, 'host-skills');
    fs.mkdirSync(host, { recursive: true });
    await withServer(home, async (view, port, hubDir) => {
      let r = await request(port, 'POST', '/api/hosts/add', {
        headers: auth(), body: { dir: host, label: '旧名' },
      });
      assert.strictEqual(r.status, 200, r.text);

      r = await request(port, 'POST', '/api/hosts/rename', {
        body: { dir: host, label: '新名' },
      });
      assert.strictEqual(r.status, 403, '无令牌必须 403');

      r = await request(port, 'POST', '/api/hosts/rename', {
        headers: auth(), body: { dir: host, label: '新名' },
      });
      assert.strictEqual(r.status, 200, r.text);
      assert.strictEqual(r.json.previous, '旧名');
      assert.strictEqual(r.json.entry.label, '新名');

      const registry = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'hosts.json'), 'utf8'));
      const entry = registry.hosts.find((item) =>
        path.resolve(item.dir).toLowerCase() === path.resolve(host).toLowerCase());
      assert.strictEqual(entry.label, '新名');

      const auditFile = path.join(hubDir, '.yotta-hub-audit.jsonl');
      assert.ok(fs.existsSync(auditFile), 'rename 必须写审计');
      const auditText = fs.readFileSync(auditFile, 'utf8');
      assert.match(auditText, /hosts\.rename/);

      r = await request(port, 'POST', '/api/hosts/rename', {
        headers: auth(), body: { dir: host },
      });
      assert.strictEqual(r.status, 400, '缺 label 必须 400');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
