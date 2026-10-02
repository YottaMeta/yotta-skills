'use strict';
/**
 * domain / --only 过滤回归（0.24.0 C 批）：
 * 清单 domain 合法性、--domain / --only 过滤与并集去重、未知 domain 与空交集错误路径。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(__dirname, 'helpers', 'fake-npm.js');
const KNOWN_DOMAINS = ['security', 'quality', 'memory', 'writing', 'workflow', 'entry', 'compliance', 'education', 'distribution'];

const CATALOG = [
  { slug: 'yotta-alpha', name: '元甲', pkg: '@fake/alpha', version: '0.1.0', domain: 'security', desc: 'fixture alpha' },
  { slug: 'yotta-beta', name: '元乙', pkg: '@fake/beta', version: '0.2.0', domain: 'education', desc: 'fixture beta' },
  { slug: 'yotta-gamma', name: '元丙', pkg: '@fake/gamma', version: '0.3.0', domain: 'security', desc: 'fixture gamma' },
];

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(home, name, skills) {
  const file = path.join(home, name);
  fs.writeFileSync(file, JSON.stringify({ manifestVersion: 1, updated: '2026-10-02', skills }, null, 2) + '\n', 'utf8');
  return file;
}

function makeEnv(home, catalog, log) {
  return {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    YOTTA_SKILLS_MANIFEST: catalog,
    YOTTA_SKILLS_FAKE_CATALOG: catalog,
    YOTTA_SKILLS_NPM: FAKE_NPM,
    YOTTA_SKILLS_FETCH: 'npm',
    YOTTA_SKILLS_FAKE_LOG: log,
  };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
}

test('skills.json 每条技能都有合法 domain（对齐 9 类家族索引）', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.json'), 'utf8'));
  assert.ok(data.skills.length > 0);
  for (const skill of data.skills) {
    assert.ok(KNOWN_DOMAINS.includes(skill.domain), skill.slug + ' domain 非法: ' + skill.domain);
  }
});

test('--domain / --only 过滤与并集去重（dry-run 预览）', () => {
  const home = tmpdir('ys-domain-home-');
  const dest = tmpdir('ys-domain-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', CATALOG);
    const env = makeEnv(home, catalog, path.join(home, 'pack.log'));

    const byDomain = runCli(['install', '--domain', 'education', '--dry-run', '--dir', dest], env);
    assert.strictEqual(byDomain.status, 0, byDomain.stdout + byDomain.stderr);
    assert.ok(byDomain.stdout.includes('yotta-beta'), 'education 应命中 beta');
    assert.ok(!byDomain.stdout.includes('yotta-alpha'), 'education 不应命中 alpha');

    const byOnly = runCli(['install', '--only', 'yotta-alpha,yotta-gamma', '--dry-run', '--dir', dest], env);
    assert.strictEqual(byOnly.status, 0, byOnly.stdout + byOnly.stderr);
    assert.ok(byOnly.stdout.includes('yotta-alpha'));
    assert.ok(byOnly.stdout.includes('yotta-gamma'));
    assert.ok(!byOnly.stdout.includes('yotta-beta'));

    const union = runCli(['install', 'yotta-alpha', '--only', 'yotta-beta', '--dry-run', '--dir', dest], env);
    assert.strictEqual(union.status, 0, union.stdout + union.stderr);
    assert.strictEqual((union.stdout.match(/yotta-alpha/g) || []).length, 1, '并集应去重');
    assert.strictEqual((union.stdout.match(/yotta-beta/g) || []).length, 1, '并集应去重');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('未知 domain → 退出码 2 并列出可用值', () => {
  const home = tmpdir('ys-domain-unknown-home-');
  const dest = tmpdir('ys-domain-unknown-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', CATALOG);
    const r = runCli(['install', '--domain', 'nope', '--dir', dest], makeEnv(home, catalog, path.join(home, 'pack.log')));
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /未知 domain: nope/);
    assert.match(r.stderr, /security/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('--domain 与 --only 空交集 → 退出码 2 且明确输出', () => {
  const home = tmpdir('ys-domain-empty-home-');
  const dest = tmpdir('ys-domain-empty-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', CATALOG);
    const r = runCli(
      ['install', '--domain', 'education', '--only', 'yotta-alpha', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog, path.join(home, 'pack.log')),
    );
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /过滤后没有匹配的技能/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('--domain 实际安装只落对应子集；update --domain 只更新该子集', () => {
  const home = tmpdir('ys-domain-install-home-');
  const dest = tmpdir('ys-domain-install-dest-');
  try {
    const catalog = writeCatalog(home, 'skills.json', CATALOG);
    const install = runCli(
      ['install', '--domain', 'security', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog, path.join(home, 'pack1.log')),
    );
    assert.strictEqual(install.status, 0, install.stdout + install.stderr);
    assert.ok(fs.existsSync(path.join(dest, 'yotta-alpha', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(dest, 'yotta-gamma', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(dest, 'yotta-beta')), 'education 不应被安装');

    const catalog2 = writeCatalog(home, 'skills-v2.json', CATALOG.map((s) => ({
      ...s,
      version: s.slug === 'yotta-alpha' ? '0.1.1' : (s.slug === 'yotta-gamma' ? '0.3.1' : '0.2.1'),
    })));
    const update = runCli(
      ['update', '--domain', 'security', '--dir', dest, '--skip-scan', '--no-reindex'],
      makeEnv(home, catalog2, path.join(home, 'pack2.log')),
    );
    assert.strictEqual(update.status, 0, update.stdout + update.stderr);
    const alpha = fs.readFileSync(path.join(dest, 'yotta-alpha', 'SKILL.md'), 'utf8');
    const gamma = fs.readFileSync(path.join(dest, 'yotta-gamma', 'SKILL.md'), 'utf8');
    assert.match(alpha, /version: 0\.1\.1/);
    assert.match(gamma, /version: 0\.3\.1/);
    assert.ok(!fs.existsSync(path.join(dest, 'yotta-beta')), 'update --domain security 不应补装 education');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
