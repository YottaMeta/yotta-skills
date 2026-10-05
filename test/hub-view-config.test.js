'use strict';
/**
 * 0.29.2 U4：面板「Hub 位置」端点（/api/hub/config set / clear + overview 来源与重启提示）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const viewLib = require('../lib/hub-view-server');

const TOKEN = 'test-view-token';
const PANEL_HTML = '<!doctype html><html><head><meta name="robots" content="noindex"><meta name="yotta-view-token" content="__YOTTA_VIEW_TOKEN__"></head><body><h1>元阁 · 技能枢纽</h1></body></html>';

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function auth() {
  return { [viewLib.TOKEN_HEADER]: TOKEN };
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
    version: '0.29.2-test',
    token: TOKEN,
    html: PANEL_HTML,
  });
  await new Promise((resolve, reject) => {
    view.server.once('error', reject);
    view.server.listen(0, '127.0.0.1', resolve);
  });
  const port = view.server.address().port;
  try {
    await fn(view, port);
  } finally {
    await view.close();
  }
}

test('panel hub config set / clear writes config.json and reports restartRequired', async () => {
  const home = tmp('ys-view-hubcfg-');
  try {
    const newHub = path.join(home, 'panel-hub');
    await withServer(home, async (view, port) => {
      const badConfirm = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { hub: newHub, confirm: 'wrong' },
      });
      assert.strictEqual(badConfirm.status, 400);

      const set = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { hub: newHub, confirm: 'hub-config' },
      });
      assert.strictEqual(set.status, 200, set.text);
      assert.strictEqual(set.json.restartRequired, true);

      const raw = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'config.json'), 'utf8'));
      assert.strictEqual(path.resolve(raw.hub), path.resolve(newHub));

      const overview = await request(port, 'GET', '/api/overview');
      assert.strictEqual(overview.status, 200, overview.text);
      assert.strictEqual(path.resolve(overview.json.hub.configured), path.resolve(newHub));
      assert.strictEqual(overview.json.hub.restartRequired, true);

      const clear = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { clear: true, confirm: 'hub-config' },
      });
      assert.strictEqual(clear.status, 200, clear.text);
      assert.strictEqual(clear.json.removed, newHub);

      const after = await request(port, 'GET', '/api/overview');
      assert.strictEqual(after.json.hub.configured, null);
      assert.strictEqual(after.json.hub.restartRequired, false);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('panel hub config rejects self-install overlap and requires the write token', async () => {
  const home = tmp('ys-view-hubcfg-guard-');
  try {
    await withServer(home, async (view, port) => {
      const noToken = await request(port, 'POST', '/api/hub/config', {
        body: { hub: path.join(home, 'x'), confirm: 'hub-config' },
      });
      assert.strictEqual(noToken.status, 403);

      const overlap = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { hub: path.join(home, '.yottaskills', 'yotta-skills'), confirm: 'hub-config' },
      });
      assert.strictEqual(overlap.status, 400);
      assert.match(overlap.json.error, /独立安装目录/);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
