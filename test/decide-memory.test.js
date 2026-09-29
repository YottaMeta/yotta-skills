'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'yotta-skills.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-provider.js');

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-m1-'));
  const skills = path.join(home, 'skills');
  for (const slug of ['yotta-memory', 'yotta-workflow']) {
    const dir = path.join(skills, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'),
      '---\nname: ' + slug + '\nversion: 1.0.0\ndescription: 测试技能 ' + slug + '，适合跨会话记忆与工作流恢复。\n---\n# ' + slug + '\n', 'utf8');
  }
  const providerHome = path.join(home, 'provider-home');
  fs.mkdirSync(providerHome, { recursive: true });
  const registryFile = path.join(home, '.yottaskills', 'registry.json');
  const usageFile = path.join(home, '.yottaskills', 'usage.json');
  const reportFile = path.join(home, '.yottaskills', 'memory-adjudication.json');
  const env = Object.assign({}, process.env, {
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    YOTTA_PROVIDER_HOME: providerHome,
    YOTTA_SKILLS_REGISTRY_FILE: registryFile,
    YOTTA_SKILLS_USAGE_FILE: usageFile,
  });
  return { home, skills, providerHome, registryFile, usageFile, reportFile, env };
}

function writeProvider(home, command, extra) {
  fs.writeFileSync(path.join(home, 'provider.json'), JSON.stringify({
    schema: 1,
    providers: [Object.assign({
      id: 'fake-m1',
      capabilities: ['m1.adjudicate'],
      command,
    }, extra || {})],
  }), 'utf8');
}

function run(env, skills, args) {
  return spawnSync(process.execPath, [BIN].concat(args).concat(['--dir', skills]), {
    encoding: 'utf8',
    env,
  });
}

function custom(data) {
  return [process.execPath, FIXTURE, 'custom', JSON.stringify(data)];
}

test('无 provider：not_installed，不写建议文件', () => {
  const ctx = setup();
  try {
    const r = run(ctx.env, ctx.skills, ['decide-memory', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.m1.status, 'not_installed');
    assert.deepStrictEqual(data.m1.decisions, []);
    assert.ok(!fs.existsSync(ctx.reportFile));
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('provider active：白名单内按分数排序，未知 slug 丢弃', () => {
  const ctx = setup();
  try {
    writeProvider(ctx.providerHome, custom({
      decisions: [
        { slug: 'ghost', verdict: 'promote', score: 99, reasons: ['ghost'], signals: {} },
        { slug: 'yotta-workflow', verdict: 'hold', score: 40, reasons: ['hold'], signals: {} },
        { slug: 'yotta-memory', verdict: 'promote', score: 78, reasons: ['used x2'], signals: { used: 2 } },
      ],
    }));
    const r = run(ctx.env, ctx.skills, ['decide-memory', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.m1.status, 'active');
    assert.strictEqual(data.m1.applied, true);
    assert.deepStrictEqual(data.m1.decisions.map((d) => d.slug), ['yotta-memory', 'yotta-workflow']);
    assert.deepStrictEqual(data.m1.dropped, ['ghost']);
    assert.deepStrictEqual(data.m1.summary, { promote: 1, hold: 1, demote: 0 });
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('license_required / timeout / invalid_output：fail-open，退出码 0', () => {
  const cases = [
    ['license', ['license'], 'license_required'],
    ['hang', ['hang'], 'timeout'],
    ['invalid', ['invalid'], 'invalid_output'],
  ];
  for (const item of cases) {
    const ctx = setup();
    try {
      writeProvider(ctx.providerHome, [process.execPath, FIXTURE, item[1][0]], item[1][0] === 'hang' ? { timeout_ms: 200 } : {});
      const r = run(ctx.env, ctx.skills, ['decide-memory', '--json']);
      assert.strictEqual(r.status, 0, r.stderr);
      const data = JSON.parse(r.stdout);
      assert.strictEqual(data.m1.status, item[2]);
      assert.deepStrictEqual(data.m1.decisions, []);
    } finally {
      fs.rmSync(ctx.home, { recursive: true, force: true });
    }
  }
});

test('非法 decision：非法 score / verdict 丢弃', () => {
  const ctx = setup();
  try {
    writeProvider(ctx.providerHome, custom({
      decisions: [
        { slug: 'yotta-memory', verdict: 'promote', score: 200, reasons: [], signals: {} },
        { slug: 'yotta-workflow', verdict: 'unknown', score: 50, reasons: [], signals: {} },
      ],
    }));
    const r = run(ctx.env, ctx.skills, ['decide-memory', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.deepStrictEqual(data.m1.decisions, []);
    assert.deepStrictEqual(data.m1.dropped, ['yotta-memory', 'yotta-workflow']);
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('--dry-run 不写建议文件；--promote 只写建议文件并生成 memory_candidates', () => {
  const ctx = setup();
  try {
    writeProvider(ctx.providerHome, custom({
      decisions: [
        { slug: 'yotta-memory', verdict: 'promote', score: 78, reasons: ['used x2'], signals: { used: 2 } },
        { slug: 'yotta-workflow', verdict: 'hold', score: 40, reasons: ['hold'], signals: {} },
      ],
    }));
    let r = run(ctx.env, ctx.skills, ['decide-memory', '--dry-run', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(ctx.reportFile));

    r = run(ctx.env, ctx.skills, ['decide-memory', '--promote', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(ctx.reportFile));
    const report = JSON.parse(fs.readFileSync(ctx.reportFile, 'utf8'));
    assert.strictEqual(report.mode, 'recommendation');
    assert.strictEqual(report.memory_candidates.length, 1);
    assert.strictEqual(report.memory_candidates[0].type, 'PREF');
    assert.strictEqual(report.memory_candidates[0].subject, '技能索引：yotta-memory');

    r = run(ctx.env, ctx.skills, ['decide-memory', '--dry-run', '--promote']);
    assert.strictEqual(r.status, 2);
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});
