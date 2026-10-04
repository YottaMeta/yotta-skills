'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const hub = require('../lib/hub');
const snapshotLib = require('../lib/install-snapshot');
const viewLib = require('../lib/hub-view-server');

const TOKEN = 'test-view-token';
const PANEL_HTML = '<!doctype html><html><head><meta name="robots" content="noindex"><meta name="yotta-view-token" content="__YOTTA_VIEW_TOKEN__"></head><body><h1>元阁 · 技能枢纽</h1></body></html>';

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version, marker) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'marker.txt'), marker || (slug + '@' + version), 'utf8');
}

function makeEnv(home) {
  return {
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
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

async function start(home, options) {
  const opts = options || {};
  const hubDir = opts.hubDir || path.join(home, '.yottaskills', 'hub');
  const view = viewLib.createHubViewServer({
    hubDir,
    homeDir: home,
    env: makeEnv(home),
    manifest: opts.manifest || [],
    version: '0.26.0-test',
    token: TOKEN,
    html: PANEL_HTML,
    scanSkill: opts.scanSkill || null,
  });
  await new Promise((resolve, reject) => {
    view.server.once('error', reject);
    view.server.listen(0, '127.0.0.1', resolve);
  });
  return view;
}

async function withServer(home, fn, options) {
  const view = await start(home, options);
  try {
    await fn(view, view.server.address().port);
  } finally {
    await view.close();
  }
}

test('view server serves the panel shell with the security headers and a token', async () => {
  const home = tmp('ys-view-home-');
  try {
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/');
      assert.strictEqual(res.status, 200);
      assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.strictEqual(res.headers['x-frame-options'], 'DENY');
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      assert.match(res.text, /yotta-view-token" content="test-view-token"/);
      assert.ok(!res.text.includes(viewLib.TOKEN_PLACEHOLDER), 'placeholder must be replaced');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('view server rejects a non-loopback Host header', async () => {
  const home = tmp('ys-view-host-');
  try {
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/status', { headers: { Host: 'evil.example' } });
      assert.strictEqual(res.status, 403);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('view server rejects cross-origin requests and cross-site fetch metadata', async () => {
  const home = tmp('ys-view-origin-');
  try {
    await withServer(home, async (view, port) => {
      const origin = await request(port, 'GET', '/api/status', { headers: { Origin: 'http://evil.example' } });
      assert.strictEqual(origin.status, 403);
      const site = await request(port, 'GET', '/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
      assert.strictEqual(site.status, 403);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('view server replaces an unsafe custom token with a generated token', async () => {
  const home = tmp('ys-view-token-safe-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    const view = viewLib.createHubViewServer({
      hubDir,
      homeDir: home,
      env: makeEnv(home),
      version: '0.26.0-test',
      token: 'bad"<token>',
      html: PANEL_HTML,
    });
    try {
      assert.match(view.token, /^[A-Za-z0-9_-]{8,128}$/);
      await new Promise((resolve, reject) => {
        view.server.once('error', reject);
        view.server.listen(0, '127.0.0.1', resolve);
      });
      const res = await request(view.server.address().port, 'GET', '/');
      assert.ok(res.text.includes(view.token));
      assert.ok(!res.text.includes('bad"<token>'));
    } finally {
      await view.close();
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('overview matches the hub CLI numbers and includes doctor state', async () => {
  const home = tmp('ys-view-overview-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-one'), 'yotta-one', '1.0.0');
    writeSkill(path.join(hubDir, 'yotta-two'), 'yotta-two', '1.0.0');
    const hostDir = path.join(home, '.codex', 'skills');
    hub.linkSkills({ hubDir, targetDir: hostDir, slugs: ['yotta-one'] });
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/overview');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.status.summary.skills, 2);
      assert.strictEqual(res.json.status.summary.links, 1);
      assert.strictEqual(res.json.version, '0.26.0-test');
      assert.ok(res.json.doctor, 'doctor payload must be present');
      assert.ok(Array.isArray(res.json.doctor.checks));
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hosts payload lists discovered directories with hub link counts', async () => {
  const home = tmp('ys-view-hosts-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-one'), 'yotta-one', '1.0.0');
    const hostDir = path.join(home, '.codex', 'skills');
    hub.linkSkills({ hubDir, targetDir: hostDir, slugs: ['yotta-one'] });
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/hosts');
      assert.strictEqual(res.status, 200);
      const codex = res.json.hosts.find((item) => path.resolve(item.dir) === path.resolve(hostDir));
      assert.ok(codex, 'codex host dir must be discovered');
      assert.strictEqual(codex.exists, true);
      assert.strictEqual(codex.hubLinks, 1);
      assert.strictEqual(res.json.summary.links, 1);
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('adopt scan reports external candidates and their variants', async () => {
  const home = tmp('ys-view-adopt-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-one'), 'yotta-one', '1.0.0');
    const hostDir = path.join(home, '.codex', 'skills');
    writeSkill(path.join(hostDir, 'external-skill'), 'external-skill', '2.0.0');
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/adopt/scan');
      assert.strictEqual(res.status, 200);
      const candidate = res.json.candidates.find((item) => item.slug === 'external-skill');
      assert.ok(candidate, 'external candidate must be listed');
      assert.strictEqual(candidate.inHub, false);
      assert.strictEqual(candidate.variants.length, 1);
      assert.strictEqual(typeof res.json.scan.available, 'boolean');
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('empty hub doctor fails with the hub_nonempty guidance', async () => {
  const home = tmp('ys-view-empty-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    fs.mkdirSync(hubDir, { recursive: true });
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/doctor');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.ok, false);
      assert.ok(res.json.checks.some((check) => check.id === 'hub_nonempty' && !check.ok));
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('records returns evidence, hub audit and rollback snapshots with sources', async () => {
  const home = tmp('ys-view-records-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-one'), 'yotta-one', '1.0.0');
    hub.appendAudit(hubDir, { event: 'adopt', slug: 'yotta-one', verdict: 'SAFE TO INSTALL' });
    const installLog = path.join(home, '.yottaskills', 'install-log.jsonl');
    fs.mkdirSync(path.dirname(installLog), { recursive: true });
    fs.writeFileSync(installLog, JSON.stringify({ event: 'install', skill: 'yotta-one', decision: 'ok' }) + '\n', 'utf8');
    const target = path.join(home, '.codex', 'skills', 'yotta-one');
    writeSkill(target, 'yotta-one', '1.0.0');
    const snapshot = snapshotLib.createSnapshot(target, { slug: 'yotta-one', homeDir: home });
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/records?limit=20');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.evidence.entries.length, 1);
      assert.ok(res.json.audit.entries.length >= 1);
      assert.strictEqual(res.json.snapshots.length, 1);
      assert.strictEqual(res.json.snapshots[0].source, path.resolve(target));
      assert.strictEqual(res.json.snapshots[0].path, snapshot.path);
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('route endpoint returns a static playbook plus a dynamic block', async () => {
  const home = tmp('ys-view-route-');
  try {
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/route?request=' + encodeURIComponent('发布前质量检查'));
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.playbook && res.json.playbook.id, 'playbook id expected');
      assert.ok(Array.isArray(res.json.skills) && res.json.skills.length > 0);
      assert.ok(res.json.dynamic && res.json.dynamic.status, 'dynamic block expected');
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('write endpoints require the session token', async () => {
  const home = tmp('ys-view-token-');
  try {
    await withServer(home, async (view, port) => {
      const noToken = await request(port, 'POST', '/api/adopt/apply', { body: { include: ['x'] } });
      assert.strictEqual(noToken.status, 403);
      const badToken = await request(port, 'POST', '/api/adopt/apply', {
        body: { include: ['x'] },
        headers: { [viewLib.TOKEN_HEADER]: 'wrong-token' },
      });
      assert.strictEqual(badToken.status, 403);
      const unknown = await request(port, 'POST', '/api/unknown', {
        body: {},
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(unknown.status, 404);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('adopt apply blocks without a scan engine and refuses a panel scan bypass', async () => {
  const home = tmp('ys-view-apply-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    const hostDir = path.join(home, '.codex', 'skills');
    writeSkill(path.join(hostDir, 'external-skill'), 'external-skill', '2.0.0');
    await withServer(home, async (view, port) => {
      const blocked = await request(port, 'POST', '/api/adopt/apply', {
        body: { include: ['external-skill'] },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(blocked.status, 200);
      assert.strictEqual(blocked.json.results[0].status, 'blocked');
      assert.ok(!fs.existsSync(path.join(hubDir, 'external-skill')), 'blocked import must not write');

      const bypass = await request(port, 'POST', '/api/adopt/apply', {
        body: { include: ['external-skill'], skipScan: true },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(bypass.status, 400);
      assert.match(bypass.json.error, /不提供跳过/);
      assert.ok(!fs.existsSync(path.join(hubDir, 'external-skill')), 'panel must not bypass the scan gate');
    }, {
      hubDir,
      scanSkill: (skillDir, found, scanOpts) => (scanOpts && scanOpts.skipScan
        ? { ok: true, verdict: 'explicit-unverified', counts: null, block: false }
        : { ok: false, error: '未找到元信扫描引擎（测试注入）' }),
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('adopt apply uses the shared scan channel and records the verdict', async () => {
  const home = tmp('ys-view-apply-scan-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    const hostDir = path.join(home, '.codex', 'skills');
    writeSkill(path.join(hostDir, 'external-skill'), 'external-skill', '2.0.0');
    const calls = [];
    await withServer(home, async (view, port) => {
      const res = await request(port, 'POST', '/api/adopt/apply', {
        body: { include: ['external-skill'] },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.results[0].status, 'imported');
      assert.strictEqual(res.json.results[0].scanVerdict, 'SAFE TO INSTALL');
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].endsWith(path.join('skills', 'external-skill')), calls[0]);
    }, {
      hubDir,
      scanSkill: (skillDir) => {
        calls.push(skillDir);
        return { ok: true, verdict: 'SAFE TO INSTALL', counts: { critical: 0, high: 0 }, block: false };
      },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('links apply/remove roundtrip uses discovered host dirs and the confirm string', async () => {
  const home = tmp('ys-view-links-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-one'), 'yotta-one', '1.0.0');
    const hostDir = path.join(home, '.codex', 'skills');
    await withServer(home, async (view, port) => {
      const plan = await request(port, 'GET', '/api/links/plan?dir=' + encodeURIComponent(hostDir));
      assert.strictEqual(plan.status, 200);
      assert.ok(plan.json.results.some((item) => item.status === 'would-link'));

      const linked = await request(port, 'POST', '/api/links/apply', {
        body: { targetDir: hostDir, slugs: ['yotta-one'] },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(linked.status, 200);
      assert.strictEqual(linked.json.results[0].status, 'linked');
      assert.ok(fs.lstatSync(path.join(hostDir, 'yotta-one')).isSymbolicLink());

      const refused = await request(port, 'POST', '/api/links/remove', {
        body: { targetDir: hostDir, slugs: ['yotta-one'] },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(refused.status, 400);
      assert.ok(fs.existsSync(path.join(hostDir, 'yotta-one')), 'missing confirm must not unlink');

      const removed = await request(port, 'POST', '/api/links/remove', {
        body: { targetDir: hostDir, slugs: ['yotta-one'], confirm: viewLib.CONFIRM.unlink },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(removed.status, 200);
      assert.strictEqual(removed.json.results[0].status, 'unlinked');
      assert.ok(!fs.existsSync(path.join(hostDir, 'yotta-one')));
      assert.ok(fs.existsSync(path.join(hubDir, 'yotta-one')), 'hub source must remain');
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rollback apply restores the recorded source and writes evidence', async () => {
  const home = tmp('ys-view-rollback-');
  try {
    const target = path.join(home, '.codex', 'skills', 'yotta-one');
    writeSkill(target, 'yotta-one', '1.0.0', 'original');
    const snapshot = snapshotLib.createSnapshot(target, { slug: 'yotta-one', homeDir: home });
    fs.writeFileSync(path.join(target, 'marker.txt'), 'changed', 'utf8');
    await withServer(home, async (view, port) => {
      const bad = await request(port, 'POST', '/api/rollback/apply', {
        body: { slug: 'yotta-one', snapshot: snapshot.path, confirm: 'wrong' },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(bad.status, 400);

      const res = await request(port, 'POST', '/api/rollback/apply', {
        body: { slug: 'yotta-one', snapshot: snapshot.path, confirm: viewLib.CONFIRM.rollback },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.ok, true);
      assert.strictEqual(res.json.source, path.resolve(target));
      assert.strictEqual(fs.readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
      const evidence = path.join(home, '.yottaskills', 'install-log.jsonl');
      assert.ok(fs.readFileSync(evidence, 'utf8').includes('"event":"rollback"'));
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('links view flags a broken junction and can clean it through the panel API', async () => {
  const home = tmp('ys-view-broken-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-one'), 'yotta-one', '1.0.0');
    const hostDir = path.join(home, '.codex', 'skills');
    hub.linkSkills({ hubDir, targetDir: hostDir, slugs: ['yotta-one'] });
    fs.rmSync(path.join(hubDir, 'yotta-one'), { recursive: true, force: true });
    await withServer(home, async (view, port) => {
      const links = await request(port, 'GET', '/api/links');
      assert.strictEqual(links.status, 200);
      assert.strictEqual(links.json.links[0].status, 'broken');
      const doctor = await request(port, 'GET', '/api/doctor');
      assert.strictEqual(doctor.json.ok, false);

      const removed = await request(port, 'POST', '/api/links/remove', {
        body: { targetDir: hostDir, slugs: ['yotta-one'], confirm: viewLib.CONFIRM.unlink },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(removed.status, 200);
      assert.strictEqual(removed.json.results[0].status, 'unlinked');
      let remains = true;
      try { fs.lstatSync(path.join(hostDir, 'yotta-one')); } catch (_) { remains = false; }
      assert.strictEqual(remains, false, 'broken junction must be removed');
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('rollback refuses snapshots outside the per-slug snapshot root', async () => {
  const home = tmp('ys-view-rollback-guard-');
  const elsewhere = tmp('ys-view-rollback-outside-');
  try {
    const target = path.join(home, '.codex', 'skills', 'yotta-one');
    writeSkill(target, 'yotta-one', '1.0.0');
    const outside = path.join(elsewhere, 'fake-snapshot');
    writeSkill(outside, 'yotta-one', '1.0.0');
    await withServer(home, async (view, port) => {
      const res = await request(port, 'POST', '/api/rollback/apply', {
        body: { slug: 'yotta-one', snapshot: outside, confirm: viewLib.CONFIRM.rollback },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.json.error, /快照目录/);
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('view help endpoint serves the full CLI model (groups / quick / options)', async () => {
  const home = tmp('ys-view-help-');
  try {
    const cliHelp = require('../lib/cli-help');
    await withServer(home, async (view, port) => {
      const res = await request(port, 'GET', '/api/help');
      assert.strictEqual(res.status, 200, res.text);
      assert.deepStrictEqual(res.json.groups, JSON.parse(JSON.stringify(cliHelp.CLI_HELP_MODEL)));
      assert.deepStrictEqual(res.json.quick, JSON.parse(JSON.stringify(cliHelp.CLI_HELP_QUICK)));
      assert.deepStrictEqual(res.json.options, JSON.parse(JSON.stringify(cliHelp.CLI_GLOBAL_OPTIONS)));
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('panel remove: preview, token + confirm gates, then removes links and hub entry', async () => {
  const home = tmp('ys-view-remove-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    const hostDir = path.join(home, '.codex', 'skills');
    writeSkill(path.join(hubDir, 'yotta-one'), 'yotta-one', '1.0.0');
    hub.linkSkills({ hubDir, targetDir: hostDir, slugs: ['yotta-one'], manifest: ['yotta-one'] });

    await withServer(home, async (view, port) => {
      const plan = await request(port, 'GET', '/api/skills/remove-plan?slug=yotta-one');
      assert.strictEqual(plan.status, 200, plan.text);
      assert.strictEqual(plan.json.verdict, 'dry-run');
      assert.strictEqual(plan.json.unlinkable, 1);
      assert.ok(fs.existsSync(path.join(hubDir, 'yotta-one')), 'preview must not write');

      const noToken = await request(port, 'POST', '/api/skills/remove', {
        body: { slug: 'yotta-one', confirm: 'remove', confirmSlug: 'yotta-one' },
      });
      assert.strictEqual(noToken.status, 403);

      const wrongConfirm = await request(port, 'POST', '/api/skills/remove', {
        body: { slug: 'yotta-one', confirm: 'nope', confirmSlug: 'yotta-one' },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(wrongConfirm.status, 400);

      const wrongSlug = await request(port, 'POST', '/api/skills/remove', {
        body: { slug: 'yotta-one', confirm: viewLib.CONFIRM.remove, confirmSlug: 'yotta-two' },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(wrongSlug.status, 400);
      assert.ok(fs.existsSync(path.join(hubDir, 'yotta-one')), 'failed confirm must not remove');

      const done = await request(port, 'POST', '/api/skills/remove', {
        body: { slug: 'yotta-one', confirm: viewLib.CONFIRM.remove, confirmSlug: 'yotta-one' },
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
      });
      assert.strictEqual(done.status, 200, done.text);
      assert.strictEqual(done.json.verdict, 'removed');
      assert.ok(!fs.existsSync(path.join(hostDir, 'yotta-one')), 'host link must be removed');
      assert.ok(!fs.existsSync(path.join(hubDir, 'yotta-one')), 'hub entry must be removed');
      assert.ok(done.json.trashedTo && fs.existsSync(done.json.trashedTo), 'trash copy must exist');
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('panel hosts add/remove: token gate, registry write + audit, directory untouched', async () => {
  const home = tmp('ys-view-hosts-reg-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'demo-skill'), 'demo-skill', '1.0.0');
    const custom = path.join(home, 'custom', 'skills');
    fs.mkdirSync(custom, { recursive: true });
    await withServer(home, async (view, port) => {
      const unauth = await request(port, 'POST', '/api/hosts/add', { body: { dir: custom } });
      assert.strictEqual(unauth.status, 403, '无 token 必须拒绝');

      const add = await request(port, 'POST', '/api/hosts/add', {
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
        body: { dir: custom, label: '面板宿主' },
      });
      assert.strictEqual(add.status, 200, add.text);
      assert.strictEqual(add.json.entry.dir, custom);
      const registryFile = path.join(home, '.yottaskills', 'hosts.json');
      assert.strictEqual(JSON.parse(fs.readFileSync(registryFile, 'utf8')).hosts.length, 1);

      const hosts = await request(port, 'GET', '/api/hosts');
      const item = hosts.json.hosts.find((host) => host.dir === custom);
      assert.ok(item && item.state === 'available' && item.detection === 'user-registry');

      const remove = await request(port, 'POST', '/api/hosts/remove', {
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
        body: { dir: custom },
      });
      assert.strictEqual(remove.status, 200, remove.text);
      assert.ok(fs.existsSync(custom), '移除注册不得删除目录');
      const audit = fs.readFileSync(path.join(hubDir, '.yotta-hub-audit.jsonl'), 'utf8');
      assert.match(audit, /"event":"hosts\.add"/);
      assert.match(audit, /"event":"hosts\.remove"/);
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('panel hosts purge: plan endpoint + confirm gate + trash roundtrip', async () => {
  const home = tmp('ys-view-hosts-purge-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'demo-skill'), 'demo-skill', '1.0.0');
    const orphan = path.join(home, '.claude', 'skills');
    fs.mkdirSync(orphan, { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(hubDir, 'demo-skill'), path.join(orphan, 'demo-skill'), linkType);
    fs.writeFileSync(path.join(orphan, 'keep.txt'), 'user', 'utf8');

    await withServer(home, async (view, port) => {
      const plan = await request(port, 'GET', '/api/hosts/purge-plan?dir=' + encodeURIComponent(orphan));
      assert.strictEqual(plan.status, 200, plan.text);
      assert.strictEqual(plan.json.unlinkCount, 1);
      assert.ok(fs.existsSync(path.join(orphan, 'demo-skill')), '预览不得删除链接');

      const noToken = await request(port, 'POST', '/api/hosts/purge', {
        body: { dir: orphan, confirm: viewLib.CONFIRM.purge },
      });
      assert.strictEqual(noToken.status, 403);

      const badConfirm = await request(port, 'POST', '/api/hosts/purge', {
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
        body: { dir: orphan, confirm: 'nope' },
      });
      assert.strictEqual(badConfirm.status, 400);
      assert.ok(fs.existsSync(orphan), '确认失败不得清理');

      const purge = await request(port, 'POST', '/api/hosts/purge', {
        headers: { [viewLib.TOKEN_HEADER]: TOKEN },
        body: { dir: orphan, confirm: viewLib.CONFIRM.purge },
      });
      assert.strictEqual(purge.status, 200, purge.text);
      assert.ok(purge.json.trashedTo);
      assert.strictEqual(fs.existsSync(orphan), false, '目录已移入回收站');
      assert.ok(fs.existsSync(path.join(purge.json.trashedTo, 'keep.txt')), '非链接内容随目录保留');
      assert.ok(!fs.existsSync(path.join(purge.json.trashedTo, 'demo-skill')), 'Hub 链接已删除');
    }, { hubDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
