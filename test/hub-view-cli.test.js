'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...(env || {}) },
  });
}

function getJson(port, target) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: target, timeout: 3000 }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

test('view help is documented and --port is bound to the view command', () => {
  const help = run(['--help']);
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /yotta-skills view/);
  assert.match(help.stdout, /--port <n>/);

  const wrongCommand = run(['--list', '--port', '8789']);
  assert.strictEqual(wrongCommand.status, 2);
  assert.match(wrongCommand.stderr, /--port 只能与 view 一起使用/);

  const badPort = run(['view', '--port', 'nope']);
  assert.strictEqual(badPort.status, 2);
  assert.match(badPort.stderr, /--port 端口非法/);
});

test('view CLI help renders subcommand options and counts the full option surface', () => {
  const source = fs.readFileSync(BIN, 'utf8');
  assert.ok(source.includes('s.options.map(function (f)'), 'subcommand options must be rendered in the view');
  assert.ok(source.includes('optTotal += (s.options || []).length'), 'option total must include subcommand options');
});

test('view command starts the loopback panel and answers /api/status', async () => {
  const home = tmp('ys-view-cli-');
  const child = spawn(process.execPath, [BIN, 'view', '--port', '0'], {
    cwd: ROOT,
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      CODEX_HOME: path.join(home, '.codex'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_STATE_HOME: path.join(home, '.state'),
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('view did not start: ' + stdout + stderr)), 15000);
      child.stdout.on('data', () => {
        const match = stdout.match(/URL: http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error('view exited early (' + code + '): ' + stdout + stderr));
      });
    });
    const status = await getJson(port, '/api/status');
    assert.strictEqual(status.ok, true);
    assert.strictEqual(status.hubDir, path.join(home, '.yottaskills', 'hub'));
    assert.ok(status.version);
  } finally {
    child.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
