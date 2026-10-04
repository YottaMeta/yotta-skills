'use strict';
/**
 * 0.29.0 F3：宿主状态细分（可用 / 残留 / 未创建 / 仅标记）。
 *
 * 背景：discovery 把「技能目录存在」直接计入「已装标记」，卸载残留目录会被
 * 显示为可用。修复要求：markerEvidence（应用标记）与 dirEvidence（目录存在）
 * 分开记录；状态判定 = 目录 × 实体证据（应用标记 / 用户注册 / 手动标记）；
 * CLI `hub hosts` 展示状态列并支持 --state 过滤；doctor 增加 host_state 只读检查。
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const discovery = require('../lib/agent-discovery');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
}

function fakeEnv(home) {
  return {
    USERPROFILE: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
    XDG_DATA_HOME: path.join(home, '.data'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    ProgramFiles: path.join(home, 'ProgramFiles'),
    'ProgramFiles(x86)': path.join(home, 'ProgramFilesX86'),
    YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
    YOTTA_SKILLS_HOME: path.join(home, '.yottaskills'),
  };
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

function makeMarker(home, name) {
  const programs = path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  fs.mkdirSync(programs, { recursive: true });
  fs.writeFileSync(path.join(programs, name + '.lnk'), '', 'utf8');
}

/**
 * 样本：
 * - .claude/skills 存在 + 无应用标记 → orphan（残留）
 * - .cursor/skills 存在 + Cursor 应用标记 → available（可用）
 * - Windsurf 应用标记、技能目录不存在 → marker-only（仅标记）
 * - 用户注册的自定义目录（存在）→ available（用户注册证据）
 */
function makeFixture(home) {
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor', 'skills'), { recursive: true });
  makeMarker(home, 'Cursor');
  makeMarker(home, 'Windsurf');
  const custom = path.join(home, 'custom-agent', 'skills');
  fs.mkdirSync(custom, { recursive: true });
  fs.mkdirSync(path.join(home, '.yottaskills'), { recursive: true });
  fs.writeFileSync(path.join(home, '.yottaskills', 'hosts.json'), JSON.stringify({
    version: 1,
    hosts: [{
      dir: custom,
      label: '自定义宿主',
      agentId: 'custom-agent',
      scope: 'verified',
      note: null,
      addedAt: '2026-10-04T00:00:00.000Z',
      source: 'manual',
    }],
  }, null, 2) + '\n', 'utf8');
  return { custom };
}

test('discovery 状态模型：可用 / 残留 / 仅标记 / 未创建 + 证据字段', () => {
  const home = tmp('ys-state-discovery-');
  try {
    const { custom } = makeFixture(home);
    const result = discovery.discoverHosts({
      homeDir: home,
      env: fakeEnv(home),
      includeCwd: false,
    });

    const claude = result.hosts.find((host) => host.dir === path.join(home, '.claude', 'skills'));
    assert.ok(claude, '缺少 .claude/skills 记录');
    assert.strictEqual(claude.state, 'orphan', '目录存在 + 无实体证据 = 残留');
    assert.strictEqual(claude.markerEvidence, false);
    assert.strictEqual(claude.dirEvidence, true);

    const cursor = result.hosts.find((host) => host.dir === path.join(home, '.cursor', 'skills'));
    assert.ok(cursor, '缺少 .cursor/skills 记录');
    assert.strictEqual(cursor.state, 'available', '目录存在 + 应用标记 = 可用');
    assert.strictEqual(cursor.markerEvidence, true);

    const windsurf = result.hosts.find((host) => host.agentId === 'windsurf');
    assert.ok(windsurf, '缺少 windsurf 记录');
    assert.strictEqual(windsurf.state, 'marker-only', '有应用标记 + 无目录 = 仅标记');
    assert.strictEqual(windsurf.markerEvidence, true);
    assert.strictEqual(windsurf.dirEvidence, false);

    const registered = result.hosts.find((host) => host.dir === custom);
    assert.ok(registered, '缺少用户注册目录记录');
    assert.strictEqual(registered.state, 'available', '目录存在 + 用户注册 = 可用');
    assert.strictEqual(registered.detection, 'user-registry');
    assert.strictEqual(registered.verified, true);

    // 证据 / 来源字段必须齐备（CLI --json 直接透出）。
    assert.ok(claude.evidence && typeof claude.evidence === 'object');
    assert.strictEqual(claude.stateSource, 'auto');

    // 不存在的映射目录 = 未创建。
    const deepagents = result.hosts.find((host) => host.agentId === 'deepagents');
    assert.ok(deepagents, '缺少 deepagents 记录');
    assert.strictEqual(deepagents.state, 'missing');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub hosts：状态列展示 + --state 过滤 + --json 透出状态字段', () => {
  const home = tmp('ys-state-cli-');
  try {
    makeFixture(home);
    const env = fakeEnv(home);

    const jsonRun = run(['hub', 'hosts', '--json'], env);
    assert.strictEqual(jsonRun.status, 0, jsonRun.stderr);
    const payload = JSON.parse(jsonRun.stdout);
    const claude = payload.hosts.find((host) => host.dir === path.join(home, '.claude', 'skills'));
    assert.strictEqual(claude.state, 'orphan');
    assert.ok(claude.evidence, '--json 必须透出 evidence');

    const filtered = run(['hub', 'hosts', '--state', 'orphan', '--json'], env);
    assert.strictEqual(filtered.status, 0, filtered.stderr);
    const filteredPayload = JSON.parse(filtered.stdout);
    assert.ok(filteredPayload.hosts.length >= 1);
    assert.ok(filteredPayload.hosts.every((host) => host.state === 'orphan'),
      '--state 过滤后只能包含该状态');

    const text = run(['hub', 'hosts'], env);
    assert.strictEqual(text.status, 0, text.stderr);
    assert.match(text.stdout, /残留/);
    assert.match(text.stdout, /仅标记/);

    const badState = run(['hub', 'hosts', '--state', 'bogus'], env);
    assert.strictEqual(badState.status, 2);
    assert.match(badState.stderr, /--state/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub doctor：host_state 只读检查提示残留（info，不判 fail）', () => {
  const home = tmp('ys-state-doctor-');
  try {
    const { custom } = makeFixture(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-memory'), 'yotta-memory', '0.22.1');
    const env = fakeEnv(home);

    const result = run(['hub', 'doctor', '--json', '--hub', hubDir], env);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const hostChecks = payload.checks.filter((check) => check.id.startsWith('host_state:'));
    assert.ok(hostChecks.length >= 1, 'doctor 必须包含 host_state 检查');
    assert.ok(hostChecks.every((check) => check.severity !== 'error'),
      'host_state 检查不得判 fail');
    const orphanCheck = hostChecks.find((check) => check.message.includes('.claude'));
    assert.ok(orphanCheck, '残留目录应出现在 host_state 检查里');
    assert.match(orphanCheck.message, /残留|实体未确认/);
    assert.ok(payload.ok, '有残留目录时 doctor 仍应通过（只读提示）');
    // 用户注册目录（可用）不应产生告警。
    assert.ok(!hostChecks.some((check) => check.message.includes(custom)));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
