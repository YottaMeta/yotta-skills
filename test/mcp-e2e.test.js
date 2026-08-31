'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MCP = path.join(__dirname, '..', 'scripts', 'yotta-skills-mcp.py');
const PY = process.env.YOTTA_TEST_PYTHON || 'python';

function setupEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-mcp-home-'));
  const codexHome = path.join(home, '.codex');
  const skills = path.join(codexHome, 'skills');
  fs.mkdirSync(path.join(skills, 'fake-skill'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'fake-skill', 'SKILL.md'),
    '---\nname: fake-skill\nversion: 0.4.2\ndescription: 假技能\n---\n# fake\n', 'utf8');
  const env = { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: codexHome, XDG_CONFIG_HOME: path.join(home, '.config') };
  return { home, skills, env };
}

function runMcp(input, env) {
  return spawnSync(PY, [MCP], { input, encoding: 'utf8', env, timeout: 120000 });
}

test('MCP：initialize + tools/list + list_installed_skills + describe_skill + reindex', () => {
  const { home, skills, env } = setupEnv();
  try {
    const req = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_installed_skills', arguments: {} } }),
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'describe_skill', arguments: { slug: 'fake-skill' } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'reindex', arguments: {} } }),
    ].join('\n') + '\n';
    const r = runMcp(req, env);
    assert.strictEqual(r.status, 0, 'exit: ' + r.status + '\n' + r.stderr);
    const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(lines.length, 5);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    // initialize
    assert.strictEqual(byId[1].result.serverInfo.name, 'yotta-skills');
    assert.strictEqual(byId[1].result.serverInfo.version, '0.2.0');
    // tools/list：3 个工具
    const tools = byId[2].result.tools.map((t) => t.name);
    assert.deepStrictEqual(tools, ['list_installed_skills', 'describe_skill', 'reindex']);
    // list_installed_skills
    const list = JSON.parse(byId[3].result.content[0].text);
    assert.strictEqual(list.count, 1);
    assert.strictEqual(list.skills[0].slug, 'fake-skill');
    // describe_skill
    const desc = JSON.parse(byId[4].result.content[0].text);
    assert.strictEqual(desc.skill.version, '0.4.2');
    // reindex
    const ri = JSON.parse(byId[5].result.content[0].text);
    assert.strictEqual(ri.count, 1);
    assert.ok(Array.isArray(ri.changes.added));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('MCP：describe_skill 未找到技能返回 isError', () => {
  const { home, env } = setupEnv();
  try {
    const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_skill', arguments: { slug: 'no-such-skill' } } }) + '\n';
    const r = runMcp(req, env);
    assert.strictEqual(r.status, 0);
    const line = JSON.parse(r.stdout.trim().split('\n')[0]);
    assert.strictEqual(line.result.isError, true);
    assert.ok(JSON.parse(line.result.content[0].text).error.includes('未找到技能'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
