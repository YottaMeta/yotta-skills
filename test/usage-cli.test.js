'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'yotta-skills.js');

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-usage-cli-'));
  const skills = path.join(home, 'skills');
  for (const slug of ['yotta-memory', 'yotta-workflow']) {
    const dir = path.join(skills, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'),
      '---\nname: ' + slug + '\nversion: 1.0.0\ndescription: 测试技能 ' + slug + '\n---\n# ' + slug + '\n', 'utf8');
  }
  const usageFile = path.join(home, '.yottaskills', 'usage.json');
  const env = Object.assign({}, process.env, {
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    YOTTA_SKILLS_USAGE_FILE: usageFile,
  });
  return { home, skills, usageFile, env };
}

function run(env, args) {
  return spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env });
}

test('usage status：默认关闭且不创建文件', () => {
  const ctx = setup();
  try {
    const r = run(ctx.env, ['usage', 'status', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.enabled, false);
    assert.ok(!fs.existsSync(ctx.usageFile));
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('usage enable / mark / disable / reset：CLI 全链路', () => {
  const ctx = setup();
  try {
    let r = run(ctx.env, ['usage', 'enable', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).enabled, true);

    r = run(ctx.env, ['usage', 'mark', '--skill', 'yotta-memory', '--signal', 'used', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const marked = JSON.parse(r.stdout);
    assert.strictEqual(marked.skills['yotta-memory'].used, 1);

    r = run(ctx.env, ['usage', 'disable', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).enabled, false);

    r = run(ctx.env, ['usage', 'reset', '--yes', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(ctx.usageFile));
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('usage mark：非法 signal 退出码 2', () => {
  const ctx = setup();
  try {
    const r = run(ctx.env, ['usage', 'mark', '--skill', 'yotta-memory', '--signal', 'other']);
    assert.strictEqual(r.status, 2);
    assert.ok(r.stderr.includes('signal'));
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});

test('--route：usage 默认关闭不记录，enable 后记录 route_hits 与组合对', () => {
  const ctx = setup();
  try {
    let r = run(ctx.env, ['--route', '跨会话长期记忆', '--dir', ctx.skills, '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(ctx.usageFile));

    r = run(ctx.env, ['usage', 'enable', '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    r = run(ctx.env, ['--route', '跨会话长期记忆', '--dir', ctx.skills, '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const state = JSON.parse(fs.readFileSync(ctx.usageFile, 'utf8'));
    assert.ok(state.skills['yotta-memory'].route_hits >= 1);
    assert.ok(state.skills['yotta-memory'].pairs['yotta-workflow'] >= 1);
    assert.strictEqual(state.last_route.playbook, 'long-lived-agent');
  } finally {
    fs.rmSync(ctx.home, { recursive: true, force: true });
  }
});
