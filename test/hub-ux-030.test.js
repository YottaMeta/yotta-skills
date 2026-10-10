'use strict';
/**
 * 0.30.0 UX / OPT 修复回归：
 * - UX-02 / OPT-01：hub unlink --dir 以文件系统为真源（台账缺失也能清理；空结果解释 + 其它 Hub 错位警告）
 * - OPT-02：unlink dry-run / 执行汇总
 * - UX-03：doctor「链接指向其它 Hub」一致性检查
 * - UX-04：hub config clear 有技能时默认阻断（--yes 放行）
 * - UX-08：hub hosts rename 一步改名（只改 label，目录与手动状态保持）
 * - OPT-04：hub config get 运行中面板重启提示（view-server.json + PID 存活）
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const hub = require(path.join(ROOT, 'lib', 'hub'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  const target = path.join(dir, slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
  return target;
}

function makeEnv(home) {
  return {
    USERPROFILE: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
    XDG_DATA_HOME: path.join(home, '.data'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
    YOTTA_SKILLS_HOME: path.join(home, '.yottaskills'),
  };
}

function runCli(home, args) {
  const env = { ...process.env, ...makeEnv(home) };
  delete env.YOTTA_SKILLS_HUB;
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 120000 });
}

function linkDir(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(path.resolve(target), linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch (_) { return false; }
}

function writeHubMarker(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.yotta-hub.json'),
    JSON.stringify({ standard: 'yotta-skills-hub/v1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', skills: {} }, null, 2) + '\n');
}

test('UX-02/OPT-01/02：unlink --dir 文件系统为真源（无台账也清理）+ 汇总 + 空结果解释', () => {
  const home = tmp('ys-ux030-unlink-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(hubDir, 'alpha', '1.0.0');
    writeHubMarker(hubDir);
    const host = path.join(home, 'host-skills');
    linkDir(path.join(hubDir, 'alpha'), path.join(host, 'alpha'));
    // 不写 .yotta-links.json：模拟台账缺失（hub config 错位场景）

    let r = runCli(home, ['hub', 'unlink', '--dir', host, '--dry-run']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /预演汇总: 将清理链接 1 条/);
    assert.ok(isLink(path.join(host, 'alpha')), 'dry-run 不应删除链接');

    r = runCli(home, ['hub', 'unlink', '--dir', host]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /汇总: 清理链接 1 条/);
    assert.ok(!fs.existsSync(path.join(host, 'alpha')), '应删除指向当前 Hub 的链接');

    r = runCli(home, ['hub', 'unlink', '--dir', host]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /未发现指向当前 Hub 的链接/);
    assert.match(r.stdout, /hub config get/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('UX-02：指向其它 Hub 的链接 fail-closed（不动）+ 错位警告', () => {
  const home = tmp('ys-ux030-mismatch-');
  try {
    const oldHub = path.join(home, 'old-hub');
    writeSkill(oldHub, 'alpha', '1.0.0');
    writeHubMarker(oldHub);
    const host = path.join(home, 'host-skills');
    linkDir(path.join(oldHub, 'alpha'), path.join(host, 'alpha'));

    const r = runCli(home, ['hub', 'unlink', '--dir', host]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /指向其它位置的链接/);
    assert.match(r.stdout, /hub config get/);
    assert.ok(isLink(path.join(host, 'alpha')), '其它 Hub 的链接不应被删除（fail-closed）');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('UX-03：doctor 发现链接指向其它 Hub 并告警（含修复指引）', () => {
  const home = tmp('ys-ux030-doctor-');
  try {
    const env = makeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(hubDir, 'alpha', '1.0.0');
    writeHubMarker(hubDir);
    const oldHub = path.join(home, 'old-hub');
    writeSkill(oldHub, 'alpha', '1.0.0');
    writeHubMarker(oldHub);
    const host = path.join(home, 'host-skills');
    linkDir(path.join(oldHub, 'alpha'), path.join(host, 'alpha'));

    const payload = hub.doctor({
      hubDir,
      homeDir: home,
      env,
      linkScopeDirs: [host],
    });
    const mismatch = payload.checks.filter((c) => String(c.id).startsWith('hub_mismatch:'));
    assert.strictEqual(mismatch.length, 1, JSON.stringify(payload.checks.map((c) => c.id)));
    assert.strictEqual(mismatch[0].severity, 'warning');
    assert.match(mismatch[0].message, /指向其它 Hub/);
    assert.match(mismatch[0].hint, /hub config get/);
    assert.ok(payload.summary.warnings >= 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('UX-03（CLI 端到端）：hub doctor 经发现范围输出其它 Hub 警告', () => {
  const home = tmp('ys-ux030-doctor-cli-');
  try {
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(hubDir, 'alpha', '1.0.0');
    writeHubMarker(hubDir);
    const oldHub = path.join(home, 'old-hub');
    writeSkill(oldHub, 'alpha', '1.0.0');
    writeHubMarker(oldHub);
    const host = path.join(home, 'host-skills');
    linkDir(path.join(oldHub, 'alpha'), path.join(host, 'alpha'));
    let r = runCli(home, ['hub', 'hosts', 'add', host, '--label', '测试宿主']);
    assert.strictEqual(r.status, 0, r.stderr);
    r = runCli(home, ['hub', 'doctor']);
    assert.match(r.stdout, /指向其它 Hub/);
    assert.match(r.stdout, /hub config get/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('UX-04：config clear 有技能时默认阻断，--yes 放行；无配置时保持原错误', () => {
  const home = tmp('ys-ux030-clear-');
  try {
    const configHub = path.join(home, 'my-hub');
    writeSkill(configHub, 'alpha', '1.0.0');
    let r = runCli(home, ['hub', 'config', 'set', '--hub', configHub]);
    assert.strictEqual(r.status, 0, r.stderr);

    r = runCli(home, ['hub', 'config', 'clear']);
    assert.strictEqual(r.status, 2, '有技能时 clear 必须阻断：' + r.stdout);
    assert.match(r.stderr, /被阻断/);
    assert.match(r.stderr, /--yes/);
    assert.match(r.stderr, /--move/);
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'config.json'), 'utf8'));
    assert.strictEqual(path.resolve(cfg.hub), path.resolve(configHub), '阻断后配置必须保持不变');

    r = runCli(home, ['hub', 'config', 'clear', '--yes']);
    assert.strictEqual(r.status, 0, r.stderr);
    const cfg2 = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'config.json'), 'utf8'));
    assert.strictEqual(cfg2.hub, null);

    r = runCli(home, ['hub', 'config', 'clear', '--yes']);
    assert.strictEqual(r.status, 2, '无配置可清除时应保持原错误');
    assert.match(r.stderr, /没有可清除/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('UX-08：hub hosts rename 一步改名（label 变更、目录与手动状态保持）+ 失败路径', () => {
  const home = tmp('ys-ux030-rename-');
  try {
    const host = path.join(home, 'host-skills');
    fs.mkdirSync(host, { recursive: true });
    let r = runCli(home, ['hub', 'hosts', 'add', host, '--label', '旧名']);
    assert.strictEqual(r.status, 0, r.stderr);
    r = runCli(home, ['hub', 'hosts', 'mark', host, '--state', 'ignored']);
    assert.strictEqual(r.status, 0, r.stderr);

    r = runCli(home, ['hub', 'hosts', 'rename', host, '--label', '新名']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /已改名: 旧名 -> 新名/);
    const registry = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'hosts.json'), 'utf8'));
    const entry = registry.hosts.find((x) =>
      path.resolve(x.dir).toLowerCase() === path.resolve(host).toLowerCase());
    assert.strictEqual(entry.label, '新名');
    assert.strictEqual(entry.manualState, 'ignored', 'manualState 必须保持');

    r = runCli(home, ['hub', 'hosts', 'rename', path.join(home, 'missing-dir'), '--label', 'x']);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /未找到注册项/);

    r = runCli(home, ['hub', 'hosts', 'rename', host]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /--label/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('OPT-04：config get 提示运行中面板需重启（PID 存活 + 位置不一致；死 PID 忽略）', () => {
  const home = tmp('ys-ux030-restart-');
  try {
    const oldHub = path.join(home, 'old-hub');
    const newHub = path.join(home, 'new-hub');
    writeSkill(newHub, 'alpha', '1.0.0');
    let r = runCli(home, ['hub', 'config', 'set', '--hub', newHub]);
    assert.strictEqual(r.status, 0, r.stderr);

    const markerFile = path.join(home, '.yottaskills', 'view-server.json');
    fs.writeFileSync(markerFile, JSON.stringify({
      pid: process.pid, port: 8789, hubDir: oldHub, startedAt: new Date().toISOString(),
    }) + '\n');

    r = runCli(home, ['hub', 'config', 'get']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /运行中的 view 面板/);
    assert.match(r.stdout, /重启面板后才会切到/);

    r = runCli(home, ['hub', 'config', 'get', '--json']);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.restartRequired, true);
    assert.strictEqual(data.viewServer.pid, process.pid);

    fs.writeFileSync(markerFile, JSON.stringify({
      pid: 99999999, port: 8789, hubDir: oldHub, startedAt: new Date().toISOString(),
    }) + '\n');
    r = runCli(home, ['hub', 'config', 'get']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /运行中的 view 面板/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
