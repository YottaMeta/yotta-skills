'use strict';
/**
 * 0.29.1 U2：面板宿主矩阵 payload 与动作 API
 * （unpaired 单一真源 / 不接管 / 恢复接管 / 标记 / 目录覆盖）。
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

function writeSkill(dir, slug, version) {
  const target = path.join(dir, slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
}

function writeMarker(env, name) {
  const dir = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.lnk'), '', 'utf8');
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
    version: '0.29.1-test',
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

test('U2 面板 hosts payload：unpaired 单一真源（已配对不进「无技能目录」区）', async () => {
  const home = tmp('ys-u2v-pair-');
  try {
    const env = makeEnv(home);
    writeSkill(path.join(home, '.cursor', 'skills'), 'yotta-a', '1.0.0');
    writeMarker(env, 'Cursor');
    writeMarker(env, 'Cherry Studio');
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/hosts');
      assert.strictEqual(res.status, 200, res.text);
      assert.ok(Array.isArray(res.json.unpaired), 'payload 应含 unpaired');
      assert.ok(res.json.unpaired.some((x) => x.label === 'Cherry Studio'), JSON.stringify(res.json.unpaired));
      assert.ok(!res.json.unpaired.some((x) => x.label === 'Cursor'));
      assert.ok(res.json.installed.some((x) => x.label === 'Cursor'), 'installed 全量保留（向后兼容）');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 面板动作：exclude / include（不接管与恢复接管 + 审计）', async () => {
  const home = tmp('ys-u2v-excl-');
  try {
    const env = makeEnv(home);
    writeSkill(path.join(home, '.cursor', 'skills'), 'yotta-a', '1.0.0');
    writeMarker(env, 'Cursor');
    await withServer(home, async (view, port, hubDir) => {
      const ex = await request(port, 'POST', '/api/hosts/exclude', {
        headers: auth(),
        body: { target: 'cursor' },
      });
      assert.strictEqual(ex.status, 200, ex.text);
      assert.strictEqual(ex.json.entry.kind, 'agent');

      const after = await request(port, 'GET', '/api/hosts');
      assert.ok(!after.json.hosts.some((h) => h.agentId === 'cursor'));
      assert.ok(after.json.excluded.some((x) => x.value === 'cursor'));

      const auditFile = path.join(hubDir, '.yotta-hub-audit.jsonl');
      assert.ok(fs.existsSync(auditFile), 'exclude 应写 Hub 审计');
      assert.match(fs.readFileSync(auditFile, 'utf8'), /"event":"hosts\.exclude"/);

      const inc = await request(port, 'POST', '/api/hosts/include', {
        headers: auth(),
        body: { target: 'cursor' },
      });
      assert.strictEqual(inc.status, 200, inc.text);
      const restored = await request(port, 'GET', '/api/hosts');
      assert.ok(restored.json.hosts.some((h) => h.agentId === 'cursor'));
      assert.ok(!restored.json.excluded.some((x) => x.value === 'cursor'));
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 面板动作：mark（标记可用 / 忽略）', async () => {
  const home = tmp('ys-u2v-mark-');
  try {
    const cursorDir = path.join(home, '.cursor', 'skills');
    writeSkill(cursorDir, 'yotta-a', '1.0.0');
    await withServer(home, async (view, port) => {
      const mark = await request(port, 'POST', '/api/hosts/mark', {
        headers: auth(),
        body: { dir: cursorDir, state: 'ignored' },
      });
      assert.strictEqual(mark.status, 200, mark.text);
      assert.strictEqual(mark.json.entry.manualState, 'ignored');

      const after = await request(port, 'GET', '/api/hosts');
      const host = after.json.hosts.find((h) => h.agentId === 'cursor');
      assert.ok(host);
      assert.strictEqual(host.state, 'ignored');
      assert.strictEqual(host.stateSource, 'manual');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U2 面板动作：set / clear（目录覆盖）', async () => {
  const home = tmp('ys-u2v-set-');
  try {
    const newDir = path.join(home, 'box-custom');
    writeSkill(newDir, 'yotta-b', '1.0.0');
    await withServer(home, async (view, port) => {
      const set = await request(port, 'POST', '/api/hosts/set', {
        headers: auth(),
        body: { agentId: 'box', dir: newDir },
      });
      assert.strictEqual(set.status, 200, set.text);

      const after = await request(port, 'GET', '/api/hosts');
      const host = after.json.hosts.find((h) => h.agentId === 'box');
      assert.ok(host, JSON.stringify(after.json.hosts.map((h) => h.agentId)));
      assert.strictEqual(path.resolve(host.dir).toLowerCase(), path.resolve(newDir).toLowerCase());
      assert.strictEqual(host.detection, 'override');

      const clear = await request(port, 'POST', '/api/hosts/set', {
        headers: auth(),
        body: { agentId: 'box', clear: true },
      });
      assert.strictEqual(clear.status, 200, clear.text);
      assert.strictEqual(clear.json.cleared, true);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
