'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'yotta-skills.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-provider.js');
const REQUEST = '帮我润色输出，要规范可复制，别有 AI 味';

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-route-dyn-'));
  const skills = path.join(home, 'skills');
  for (const slug of ['yotta-present', 'yotta-humanize', 'yotta-memory']) {
    const dir = path.join(skills, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'),
      '---\nname: ' + slug + '\nversion: 1.0.0\ndescription: 测试技能 ' + slug + '\n---\n# ' + slug + '\n', 'utf8');
  }
  const providerHome = path.join(home, 'provider-home');
  fs.mkdirSync(providerHome, { recursive: true });
  const env = Object.assign({}, process.env, {
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    YOTTA_PROVIDER_HOME: providerHome,
  });
  return { home, skills, providerHome, env };
}

function writeProvider(home, command, extra) {
  fs.writeFileSync(path.join(home, 'provider.json'), JSON.stringify({
    schema: 1,
    providers: [Object.assign({
      id: 'fake',
      capabilities: ['o1.route'],
      command,
    }, extra || {})],
  }), 'utf8');
}

function run(env, skills, args) {
  return spawnSync(process.execPath, [BIN].concat(args).concat(['--route', REQUEST, '--dir', skills]), {
    encoding: 'utf8',
    env,
  });
}

test('无 provider：JSON 有 dynamic=not_installed，静态字段不变；文本无动态行', () => {
  const ctx = setup();
  try {
    const jsonRun = run(ctx.env, ctx.skills, ['--json']);
    assert.strictEqual(jsonRun.status, 0, jsonRun.stderr);
    const data = JSON.parse(jsonRun.stdout);
    assert.strictEqual(data.playbook.id, 'output-standard');
    assert.strictEqual(data.dynamic.status, 'not_installed');
    assert.strictEqual(data.dynamic.applied, false);
    assert.deepStrictEqual(data.dynamic.added, []);
    assert.deepStrictEqual(data.skills.map((s) => s.slug), ['yotta-present', 'yotta-humanize']);
    const textRun = run(ctx.env, ctx.skills, []);
    assert.strictEqual(textRun.status, 0, textRun.stderr);
    assert.ok(!textRun.stdout.includes('动态路由'), '未配置时文本不应出现动态路由行');
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('provider active：白名单内重排 + 增补，未知 slug 丢弃', () => {
  const ctx = setup();
  try {
    writeProvider(ctx.providerHome, [process.execPath, FIXTURE]);
    const r = run(ctx.env, ctx.skills, ['--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dynamic.status, 'active');
    assert.strictEqual(data.dynamic.applied, true);
    assert.deepStrictEqual(data.dynamic.added, ['yotta-memory']);
    assert.deepStrictEqual(data.dynamic.dropped, ['ghost-skill']);
    assert.deepStrictEqual(data.skills.map((s) => s.slug), ['yotta-memory', 'yotta-present', 'yotta-humanize']);
    const textRun = run(ctx.env, ctx.skills, []);
    assert.ok(textRun.stdout.includes('动态路由: 已应用'), textRun.stdout);
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('license_required：状态可见，静态结果照常返回', () => {
  const ctx = setup();
  try {
    writeProvider(ctx.providerHome, [process.execPath, FIXTURE, 'license']);
    const r = run(ctx.env, ctx.skills, ['--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dynamic.status, 'license_required');
    assert.strictEqual(data.dynamic.applied, false);
    assert.deepStrictEqual(data.skills.map((s) => s.slug), ['yotta-present', 'yotta-humanize']);
    const textRun = run(ctx.env, ctx.skills, []);
    assert.ok(textRun.stdout.includes('动态路由: 需授权'), textRun.stdout);
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('超时 / 非法输出：状态记录，静态结果不变', () => {
  const cases = [
    ['hang', 'timeout', { timeout_ms: 200 }],
    ['invalid', 'invalid_output', {}],
  ];
  for (const item of cases) {
    const ctx = setup();
    try {
      writeProvider(ctx.providerHome, [process.execPath, FIXTURE, item[0]], item[2]);
      const r = run(ctx.env, ctx.skills, ['--json']);
      assert.strictEqual(r.status, 0, r.stderr);
      const data = JSON.parse(r.stdout);
      assert.strictEqual(data.dynamic.status, item[1]);
      assert.deepStrictEqual(data.skills.map((s) => s.slug), ['yotta-present', 'yotta-humanize']);
    } finally {
      fs.rmSync(ctx.home, { recursive: true, force: true });
    }
  }
});

test('provider 只返回白名单外 slug：全部丢弃、不应用', () => {
  const ctx = setup();
  try {
    writeProvider(ctx.providerHome, [
      process.execPath, FIXTURE, 'custom', JSON.stringify({ skills: [{ slug: 'ghost-skill' }] }),
    ]);
    const r = run(ctx.env, ctx.skills, ['--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.dynamic.status, 'active');
    assert.strictEqual(data.dynamic.applied, false);
    assert.deepStrictEqual(data.dynamic.dropped, ['ghost-skill']);
    assert.deepStrictEqual(data.skills.map((s) => s.slug), ['yotta-present', 'yotta-humanize']);
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});
