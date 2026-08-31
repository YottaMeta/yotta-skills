'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', 'bin', 'yotta-skills.js');

function setupEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-cli-home-'));
  const skills = path.join(home, 'skills');
  fs.mkdirSync(skills, { recursive: true });
  const fake = path.join(skills, 'fake-skill');
  fs.mkdirSync(fake, { recursive: true });
  fs.writeFileSync(path.join(fake, 'SKILL.md'),
    '---\nname: fake-skill\nversion: 0.4.2\ndescription: 假技能\n---\n# fake\n', 'utf8');
  const env = { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex'), XDG_CONFIG_HOME: path.join(home, '.config') };
  return { home, skills, env };
}

test('CLI --inventory：扫描指定目录并写入注册表（JSON 输出）', () => {
  const { home, skills, env } = setupEnv();
  try {
    const r = spawnSync(process.execPath, [BIN, '--inventory', '--dir', skills, '--json'], { encoding: 'utf8', env });
    assert.strictEqual(r.status, 0, 'exit code: ' + r.status + '\n' + r.stderr);
    const data = JSON.parse(r.stdout);
    const fk = data.skills.find((s) => s.slug === 'fake-skill');
    assert.ok(fk, 'fake-skill 应在注册表中');
    assert.strictEqual(fk.version, '0.4.2');
    assert.ok(fs.existsSync(path.join(home, '.yottaskills', 'registry.json')), '注册表文件应写入');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI --inventory：文本输出含技能与计数', () => {
  const { home, skills, env } = setupEnv();
  try {
    const r = spawnSync(process.execPath, [BIN, '--inventory', '--dir', skills], { encoding: 'utf8', env });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('fake-skill'));
    assert.ok(r.stdout.includes('共 1 个技能'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI --reindex：重扫 + 增量合并（JSON 输出 + 幂等）', () => {
  const { home, skills, env } = setupEnv();
  try {
    const r1 = spawnSync(process.execPath, [BIN, '--reindex', '--dir', skills, '--json'], { encoding: 'utf8', env });
    assert.strictEqual(r1.status, 0, 'exit: ' + r1.status + '\n' + r1.stderr);
    const d1 = JSON.parse(r1.stdout);
    assert.deepStrictEqual(d1.changes.added, ['fake-skill']);
    assert.strictEqual(d1.count, 1);
    assert.ok(d1.reindexed_at);
    // 幂等：第二次无变化
    const r2 = spawnSync(process.execPath, [BIN, '--reindex', '--dir', skills, '--json'], { encoding: 'utf8', env });
    assert.strictEqual(r2.status, 0);
    const d2 = JSON.parse(r2.stdout);
    assert.deepStrictEqual(d2.changes.added, []);
    assert.deepStrictEqual(d2.changes.updated, []);
    assert.deepStrictEqual(d2.changes.gone, []);
    assert.strictEqual(d2.count, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI --reindex：文本输出聚焦变化', () => {
  const { home, skills, env } = setupEnv();
  try {
    const r = spawnSync(process.execPath, [BIN, '--reindex', '--dir', skills], { encoding: 'utf8', env });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('re-index 完成: 新增 1 / 更新 0 / 消失 0'));
    assert.ok(r.stdout.includes('+ fake-skill'));
    assert.ok(r.stdout.includes('注册表:'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI --route：JSON 输出组合、顺序、缺失安装建议与应用模式', () => {
  const { home, skills, env } = setupEnv();
  try {
    fs.mkdirSync(path.join(skills, 'yotta-present'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'yotta-present', 'SKILL.md'),
      '---\nname: yotta-present\nversion: 0.1.2\ndescription: 输出呈现\n---\n# yotta-present\n', 'utf8');
    const r = spawnSync(process.execPath,
      [BIN, '--route', '帮我润色输出，要规范可复制，别有 AI 味', '--dir', skills, '--json'],
      { encoding: 'utf8', env });
    assert.strictEqual(r.status, 0, 'exit: ' + r.status + '\n' + r.stderr);
    const data = JSON.parse(r.stdout);
    assert.strictEqual(data.playbook.id, 'output-standard');
    assert.deepStrictEqual(data.skills.map((s) => s.slug), ['yotta-present', 'yotta-humanize']);
    assert.strictEqual(data.skills[0].installed, true);
    assert.strictEqual(data.skills[1].installed, false);
    assert.ok(data.install_command.includes('install yotta-humanize'));
    assert.strictEqual(data.application_mode.default, 'explicit');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI --route：文本输出用户可读指引', () => {
  const { home, skills, env } = setupEnv();
  try {
    const r = spawnSync(process.execPath,
      [BIN, '--route', '检查代码质量，别糊弄', '--dir', skills],
      { encoding: 'utf8', env });
    assert.strictEqual(r.status, 0, 'exit: ' + r.status + '\n' + r.stderr);
    assert.ok(r.stdout.includes('路由结果'));
    assert.ok(r.stdout.includes('交付质量门'));
    assert.ok(r.stdout.includes('缺失技能'));
    assert.ok(r.stdout.includes('安装命令'));
    assert.ok(r.stdout.includes('应用模式: 显式调用'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI --route：缺少需求参数时报错', () => {
  const { home, env } = setupEnv();
  try {
    const r = spawnSync(process.execPath, [BIN, '--route'], { encoding: 'utf8', env });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /--route 缺少需求摘要/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
