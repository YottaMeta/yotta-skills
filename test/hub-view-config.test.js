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

function writeSkill(dir, slug, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
}

async function withServer(home, fn, options) {
  const opts = options || {};
  const hubDir = opts.hubDir || path.join(home, '.yottaskills', 'hub');
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

test('panel hub config switch records lastSwitch; the restarted panel shows the pending hint', async () => {
  const home = tmp('ys-view-switch-');
  try {
    const root = path.join(home, '.yottaskills');
    const oldHub = path.join(root, 'hub');
    writeSkill(path.join(oldHub, 'yotta-demo'), 'yotta-demo', '1.0.0');
    const newHub = path.join(home, 'panel-switched-hub');
    await withServer(home, async (view, port) => {
      const set = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { hub: newHub, mode: 'switch', confirm: 'hub-config' },
      });
      assert.strictEqual(set.status, 200, set.text);
      assert.strictEqual(set.json.mode, 'switch');
      assert.strictEqual(set.json.oldSkills, 1);
      assert.ok(fs.existsSync(path.join(oldHub, 'yotta-demo', 'SKILL.md')), 'switch must not move files');
    });
    await withServer(home, async (view, port) => {
      const overview = await request(port, 'GET', '/api/overview');
      assert.strictEqual(overview.status, 200, overview.text);
      assert.ok(overview.json.migration.switchPending, JSON.stringify(overview.json.migration));
      assert.strictEqual(overview.json.migration.switchPending.skills, 1);
      assert.strictEqual(
        path.resolve(overview.json.migration.switchPending.from),
        path.resolve(oldHub),
      );
    }, { hubDir: newHub });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('panel hub config move migrates; rollback endpoint reverses the position', async () => {
  const home = tmp('ys-view-move-');
  try {
    const root = path.join(home, '.yottaskills');
    const oldHub = path.join(root, 'hub');
    writeSkill(path.join(oldHub, 'yotta-demo'), 'yotta-demo', '1.0.0');
    const newHub = path.join(home, 'panel-moved-hub');
    await withServer(home, async (view, port) => {
      const moved = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { hub: newHub, mode: 'move', confirm: 'hub-config' },
      });
      assert.strictEqual(moved.status, 200, moved.text);
      assert.strictEqual(moved.json.mode, 'move');
      assert.strictEqual(moved.json.move.moved, true);
      assert.strictEqual(moved.json.move.verifiedSkills, 1);
      assert.ok(fs.existsSync(path.join(newHub, 'yotta-demo', 'SKILL.md')));
      assert.ok(!fs.existsSync(oldHub), 'old hub must be retired to trash');
    });
    await withServer(home, async (view, port) => {
      const cfg = await request(port, 'GET', '/api/hub/config');
      assert.strictEqual(cfg.status, 200, cfg.text);
      assert.ok(cfg.json.lastMigration, JSON.stringify(cfg.json));
      assert.strictEqual(cfg.json.rollback.ok, true, JSON.stringify(cfg.json.rollback));
      assert.strictEqual(path.resolve(cfg.json.rollback.target), path.resolve(oldHub));
      const rb = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { rollback: true, confirm: 'hub-config' },
      });
      assert.strictEqual(rb.status, 200, rb.text);
      assert.strictEqual(rb.json.action, 'config.rollback');
      assert.ok(fs.existsSync(path.join(oldHub, 'yotta-demo', 'SKILL.md')));
      assert.ok(!fs.existsSync(newHub), 'current hub must be retired to trash');
    }, { hubDir: newHub });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('panel hub config move reports residue-only targets and cleans on retry', async () => {
  const home = tmp('ys-view-residue-');
  try {
    const oldHub = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(oldHub, 'yotta-demo'), 'yotta-demo', '1.0.0');
    const newHub = path.join(home, 'panel-residue-hub');
    fs.mkdirSync(newHub, { recursive: true });
    fs.writeFileSync(path.join(newHub, '.yotta-hub.json'), '{}\n', 'utf8');
    await withServer(home, async (view, port) => {
      const refused = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { hub: newHub, mode: 'move', confirm: 'hub-config' },
      });
      assert.strictEqual(refused.status, 409, refused.text);
      assert.strictEqual(refused.json.code, 'target-residue');
      assert.ok(fs.existsSync(path.join(newHub, '.yotta-hub.json')), 'residue must stay before the retry');
      const cleaned = await request(port, 'POST', '/api/hub/config', {
        headers: auth(),
        body: { hub: newHub, mode: 'move', confirm: 'hub-config', cleanResidue: true },
      });
      assert.strictEqual(cleaned.status, 200, cleaned.text);
      assert.ok(fs.existsSync(path.join(newHub, 'yotta-demo', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(newHub, '.yotta-hub.json')), 'residue must be moved away');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
