'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const provider = require('../lib/provider');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-provider.js');

function tmpHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'yotta-provider-'));
}

function writeConfig(home, providers) {
  fs.writeFileSync(path.join(home, 'provider.json'), JSON.stringify({ schema: 1, providers }), 'utf8');
}

function baseProvider(extra) {
  return Object.assign({
    id: 'fake',
    capabilities: ['o1.route'],
    command: [process.execPath, FIXTURE],
  }, extra || {});
}

function withMode(mode) {
  return { command: [process.execPath, FIXTURE].concat(mode ? [mode] : []) };
}

function withHome(home, mode, fn) {
  const savedHome = process.env.YOTTA_PROVIDER_HOME;
  process.env.YOTTA_PROVIDER_HOME = home;
  try {
    return fn();
  } finally {
    if (savedHome === undefined) delete process.env.YOTTA_PROVIDER_HOME; else process.env.YOTTA_PROVIDER_HOME = savedHome;
  }
}

test('未配置 provider.json：not_installed 且不写审计', () => {
  const home = tmpHome();
  try {
    const result = withHome(home, null, () => provider.runCapability('o1.route', { request: 'x' }));
    assert.strictEqual(result.status, 'not_installed');
    assert.strictEqual(result.provider_id, '');
    assert.ok(!fs.existsSync(path.join(home, 'provider-audit.jsonl')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('正常调用：active + data，审计只有元数据、不含 payload 正文', () => {
  const home = tmpHome();
  try {
    writeConfig(home, [baseProvider(withMode())]);
    const result = withHome(home, 'ok', () => provider.runCapability('o1.route', { request: 'SECRET_MARKER_9f13' }));
    assert.strictEqual(result.status, 'active');
    assert.strictEqual(result.provider_id, 'fake');
    assert.ok(Array.isArray(result.data.skills));
    const auditFile = path.join(home, 'provider-audit.jsonl');
    assert.ok(fs.existsSync(auditFile), '应写审计');
    const auditText = fs.readFileSync(auditFile, 'utf8');
    assert.ok(!auditText.includes('SECRET_MARKER_9f13'), '审计不得包含 payload 正文');
    const line = JSON.parse(auditText.trim().split('\n')[0]);
    assert.strictEqual(line.capability, 'o1.route');
    assert.strictEqual(line.status, 'active');
    assert.strictEqual(line.provider_id, 'fake');
    assert.ok(typeof line.duration_ms === 'number');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('provider 未声明该 capability：not_installed', () => {
  const home = tmpHome();
  try {
    writeConfig(home, [baseProvider(Object.assign({ capabilities: ['memory.hook'] }, withMode()))]);
    const result = withHome(home, 'ok', () => provider.runCapability('o1.route', {}));
    assert.strictEqual(result.status, 'not_installed');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('license_required：状态与 code 透传', () => {
  const home = tmpHome();
  try {
    writeConfig(home, [baseProvider(withMode('license'))]);
    const result = withHome(home, 'license', () => provider.runCapability('o1.route', {}));
    assert.strictEqual(result.status, 'license_required');
    assert.strictEqual(result.code, 'license_required');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('provider 超时：timeout 且不阻塞', () => {
  const home = tmpHome();
  try {
    writeConfig(home, [baseProvider(Object.assign({ timeout_ms: 200 }, withMode('hang')))]);
    const started = Date.now();
    const result = withHome(home, 'hang', () => provider.runCapability('o1.route', {}));
    const elapsed = Date.now() - started;
    assert.strictEqual(result.status, 'timeout');
    assert.ok(elapsed < 3000, '超时不应长时间阻塞，实际 ' + elapsed + 'ms');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('provider 退出码非 0 / 输出非 JSON / 输出超长：error 或 invalid_output', () => {
  const cases = [
    ['exit', 'error'],
    ['invalid', 'invalid_output'],
    ['oversize', 'error'],
  ];
  for (const pair of cases) {
    const home = tmpHome();
    try {
      writeConfig(home, [baseProvider(withMode(pair[0]))]);
      const result = withHome(home, pair[0], () => provider.runCapability('o1.route', {}));
      assert.strictEqual(result.status, pair[1], pair[0] + ' 应为 ' + pair[1]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});

test('配置非法（command 为字符串 / 未知 capability）：error 且不执行', () => {
  const home = tmpHome();
  try {
    writeConfig(home, [{ id: 'bad', capabilities: ['o1.route'], command: 'node evil.js' }]);
    const first = withHome(home, 'ok', () => provider.runCapability('o1.route', {}));
    assert.strictEqual(first.status, 'error');
    writeConfig(home, [{ id: 'bad2', capabilities: ['unknown.capability'], command: [process.execPath, FIXTURE] }]);
    const second = withHome(home, 'ok', () => provider.runCapability('o1.route', {}));
    assert.strictEqual(second.status, 'error');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('command 指向不存在的可执行：error，不阻断调用方', () => {
  const home = tmpHome();
  try {
    writeConfig(home, [{
      id: 'missing',
      capabilities: ['o1.route'],
      command: [path.join(home, 'no-such-provider.js')],
    }]);
    const result = withHome(home, 'ok', () => provider.runCapability('o1.route', {}));
    assert.strictEqual(result.status, 'error');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
