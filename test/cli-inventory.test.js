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
