'use strict';
/**
 * 0.29.0 F3：残留目录清理（hub hosts remove <dir> --purge）。
 *
 * 语义：默认预览（无 --yes 不执行）；--yes 执行四步 ——
 * ① 校验目录为「残留」（实体未确认）；② 全量 unlink（只删指向 Hub 的链接）；
 * ③ 目录移入回收站（保留 7 天，输出恢复路径）；④ 清链接台账 + 写审计。
 * 非 Hub 链接 / 非技能内容保留并报告。fail-closed：可用 / Hub 真源 / 桥接 / 不存在均拒绝。
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');

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

test('残留清理：默认预览无变更；--yes 执行 unlink + 回收站 + 审计', () => {
  const home = tmp('ys-purge-flow-');
  try {
    const env = fakeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-a'), 'yotta-a', '1.0.0');
    writeSkill(path.join(hubDir, 'yotta-b'), 'yotta-b', '1.0.0');
    const orphan = path.join(home, '.claude', 'skills');
    fs.mkdirSync(orphan, { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(hubDir, 'yotta-a'), path.join(orphan, 'yotta-a'), linkType);
    fs.symlinkSync(path.join(hubDir, 'yotta-b'), path.join(orphan, 'yotta-b'), linkType);
    const other = path.join(home, 'other-target');
    fs.mkdirSync(other, { recursive: true });
    fs.symlinkSync(other, path.join(orphan, 'foreign-link'), linkType);
    fs.writeFileSync(path.join(orphan, 'keep.txt'), 'user content', 'utf8');
    // 台账登记（模拟此前 link 分发）
    fs.writeFileSync(path.join(hubDir, '.yotta-links.json'), JSON.stringify({
      standard: 'yotta-skills-hub/v1',
      version: 1,
      updatedAt: null,
      links: [
        { slug: 'yotta-a', dir: orphan, target: path.join(orphan, 'yotta-a'), hubDir: path.join(hubDir, 'yotta-a') },
        { slug: 'yotta-b', dir: orphan, target: path.join(orphan, 'yotta-b'), hubDir: path.join(hubDir, 'yotta-b') },
      ],
    }, null, 2), 'utf8');

    const preview = run(['hub', 'hosts', 'remove', orphan, '--purge', '--json', '--hub', hubDir], env);
    assert.strictEqual(preview.status, 0, preview.stderr);
    const previewPayload = JSON.parse(preview.stdout);
    assert.strictEqual(previewPayload.dryRun, true);
    assert.ok(previewPayload.unlinkCount >= 2, JSON.stringify(previewPayload));
    assert.ok(fs.existsSync(orphan), '预览不得移动目录');
    assert.ok(fs.existsSync(path.join(orphan, 'yotta-a')), '预览不得删除链接');

    const exec = run(['hub', 'hosts', 'remove', orphan, '--purge', '--yes', '--json', '--hub', hubDir], env);
    assert.strictEqual(exec.status, 0, exec.stderr);
    const payload = JSON.parse(exec.stdout);
    assert.ok(payload.trashedTo, '输出回收站路径');
    assert.strictEqual(fs.existsSync(orphan), false, '目录已移入回收站');
    assert.ok(fs.existsSync(payload.trashedTo), '回收站条目存在');
    assert.ok(!fs.existsSync(path.join(payload.trashedTo, 'yotta-a')), 'Hub 链接已删除');
    assert.ok(!fs.existsSync(path.join(payload.trashedTo, 'yotta-b')), 'Hub 链接已删除');
    assert.ok(fs.existsSync(path.join(payload.trashedTo, 'foreign-link')), '非 Hub 链接保留');
    assert.strictEqual(fs.readFileSync(path.join(payload.trashedTo, 'keep.txt'), 'utf8'), 'user content');

    const links = JSON.parse(fs.readFileSync(path.join(hubDir, '.yotta-links.json'), 'utf8')).links;
    assert.ok(!links.some((item) => item.dir === orphan), '链接台账必须清理该目录');
    const audit = fs.readFileSync(path.join(hubDir, '.yotta-hub-audit.jsonl'), 'utf8');
    assert.match(audit, /"event":"hosts\.purge"/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('残留清理 fail-closed：可用状态 / Hub 真源 / 桥接目录 / 不存在', () => {
  const home = tmp('ys-purge-guard-');
  try {
    const env = fakeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-a'), 'yotta-a', '1.0.0');

    // 可用状态（目录 + 应用标记）
    const available = path.join(home, '.cursor', 'skills');
    fs.mkdirSync(available, { recursive: true });
    makeMarker(home, 'Cursor');
    const availableAttempt = run(['hub', 'hosts', 'remove', available, '--purge', '--yes', '--hub', hubDir], env);
    assert.strictEqual(availableAttempt.status, 2);
    assert.match(availableAttempt.stderr, /残留/);

    const hubAttempt = run(['hub', 'hosts', 'remove', hubDir, '--purge', '--yes', '--hub', hubDir], env);
    assert.strictEqual(hubAttempt.status, 2);

    const bridge = path.join(home, '.state', 'skills');
    fs.mkdirSync(bridge, { recursive: true });
    const bridgeAttempt = run(['hub', 'hosts', 'remove', bridge, '--purge', '--yes', '--hub', hubDir], env);
    assert.strictEqual(bridgeAttempt.status, 2);
    assert.match(bridgeAttempt.stderr, /桥接/);

    const missingAttempt = run(['hub', 'hosts', 'remove', path.join(home, 'nope'), '--purge', '--yes', '--hub', hubDir], env);
    assert.strictEqual(missingAttempt.status, 2);
    assert.match(missingAttempt.stderr, /不存在/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('手动标记 orphan 后可清理（手动确认路径）', () => {
  const home = tmp('ys-purge-manual-');
  try {
    const env = fakeEnv(home);
    const hubDir = path.join(home, '.yottaskills', 'hub');
    writeSkill(path.join(hubDir, 'yotta-a'), 'yotta-a', '1.0.0');
    const target = path.join(home, 'custom', 'skills');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'note.txt'), 'x', 'utf8');

    const mark = run(['hub', 'hosts', 'mark', target, '--state', 'orphan'], env);
    assert.strictEqual(mark.status, 0, mark.stderr);
    const exec = run(['hub', 'hosts', 'remove', target, '--purge', '--yes', '--json', '--hub', hubDir], env);
    assert.strictEqual(exec.status, 0, exec.stderr);
    assert.strictEqual(fs.existsSync(target), false);
    // 注册表条目应随清理移除
    const registryFile = path.join(home, '.yottaskills', 'hosts.json');
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    assert.strictEqual(registry.hosts.length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
