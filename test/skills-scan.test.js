'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scan = require('../lib/skills-scan');

function mkSkill(root, slug, fmExtra, body) {
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  const fm = [
    '---',
    'name: ' + slug,
    'version: 1.2.3',
    'description: 测试技能 ' + slug,
  ];
  if (fmExtra) fm.push(fmExtra);
  fm.push('---', '');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), fm.join('\n') + (body || '# ' + slug + '\n'), 'utf8');
  return dir;
}

test('parseFrontmatter：正常解析 name/version/description 与引号值', () => {
  const text = [
    '---',
    'name: yotta-demo',
    'version: "0.9.1"',
    "description: '演示技能'",
    'license: MIT',
    '---',
    '# yotta-demo',
  ].join('\n');
  const fm = scan.parseFrontmatter(text);
  assert.strictEqual(fm.name, 'yotta-demo');
  assert.strictEqual(fm.version, '0.9.1');
  assert.strictEqual(fm.description, '演示技能');
  assert.strictEqual(fm.license, 'MIT');
});

test('parseFrontmatter：支持 YAML block scalar 多行 description', () => {
  const text = [
    '---',
    'name: yotta-multi',
    'description: >-',
    '  第一行描述',
    '  第二行描述',
    'version: 2.0.0',
    '---',
    '# body',
  ].join('\n');
  const fm = scan.parseFrontmatter(text);
  assert.strictEqual(fm.name, 'yotta-multi');
  assert.strictEqual(fm.description, '第一行描述 第二行描述');
  assert.strictEqual(fm.version, '2.0.0');
});

test('parseFrontmatter：无 frontmatter 返回 null；缺 name 则无 name 字段', () => {
  assert.strictEqual(scan.parseFrontmatter('# hello\n没有 frontmatter'), null);
  const fm = scan.parseFrontmatter('---\nversion: 1.0.0\n---\nbody');
  assert.strictEqual(fm.name, undefined);
  assert.strictEqual(fm.version, '1.0.0');
});

test('scanSkillDir：只识别含 SKILL.md 且 frontmatter 有 name 的子目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-scan-dir-'));
  try {
    mkSkill(root, 'good-skill');
    mkSkill(root, 'no-fm', null, '---\n没有闭合');
    fs.writeFileSync(path.join(root, 'no-fm', 'SKILL.md'), '# 无 frontmatter\n', 'utf8');
    mkSkill(root, 'no-name');
    fs.writeFileSync(path.join(root, 'no-name', 'SKILL.md'), '---\nversion: 1.0.0\n---\n', 'utf8');
    fs.writeFileSync(path.join(root, 'plain.txt'), 'hi', 'utf8');
    fs.mkdirSync(path.join(root, 'empty-dir'));
    const found = scan.scanSkillDir(root);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].slug, 'good-skill');
    assert.strictEqual(found[0].version, '1.2.3');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanRoots：多根扫描去重合并 + 版本冲突记录 + 缺失目录记 error', () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-scan-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-scan-b-'));
  try {
    mkSkill(rootA, 'common-skill');
    mkSkill(rootB, 'common-skill'); // 同名同版本 -> 合并 sources
    mkSkill(rootA, 'only-a');
    mkSkill(rootB, 'only-b');
    mkSkill(rootA, 'ver-skill');
    mkSkill(rootB, 'ver-skill');
    fs.writeFileSync(path.join(rootB, 'ver-skill', 'SKILL.md'),
      '---\nname: ver-skill\nversion: 9.9.9\ndescription: 版本不同\n---\n', 'utf8');
    const res = scan.scanRoots([
      { dir: rootA, label: 'A' },
      { dir: rootB, label: 'B' },
      { dir: path.join(rootA, 'no-such'), label: 'Missing' },
    ]);
    assert.strictEqual(res.errors.length, 1);
    const common = res.skills.find((s) => s.slug === 'common-skill');
    assert.ok(common);
    assert.deepStrictEqual(common.sources, ['A', 'B']);
    const ver = res.skills.find((s) => s.slug === 'ver-skill');
    assert.ok(ver.conflicts && ver.conflicts.length === 1);
    assert.strictEqual(ver.version, '1.2.3'); // 首个来源版本
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('mergeRegistry：新增 / 更新 / 消失 / 幂等', () => {
  const prev = {
    skills: {
      'old-skill': { slug: 'old-skill', version: '1.0.0', status: 'known' },
      'keep-skill': { slug: 'keep-skill', version: '2.0.0', description: 'd', sources: ['X'], source_dirs: ['/x'], status: 'known' },
    },
  };
  const scanResult = {
    skills: [
      { slug: 'keep-skill', version: '2.0.0', description: 'd', sources: ['X'], source_dirs: ['/x'] },
      { slug: 'new-skill', version: '3.0.0', description: 'n', sources: ['Y'], source_dirs: ['/y'] },
    ],
  };
  const m1 = scan.mergeRegistry(scanResult, prev);
  assert.deepStrictEqual(m1.changes.added, ['new-skill']);
  assert.deepStrictEqual(m1.changes.gone, ['old-skill']);
  assert.deepStrictEqual(m1.changes.updated, []);
  assert.strictEqual(m1.registry.skills['old-skill'].status, 'gone');
  assert.strictEqual(m1.registry.skills['keep-skill'].status, 'known');
  // 幂等：再合并一次（同状态）应无变化
  const m2 = scan.mergeRegistry(scanResult, m1.registry);
  assert.deepStrictEqual(m2.changes.added, []);
  assert.deepStrictEqual(m2.changes.updated, []);
  assert.deepStrictEqual(m2.changes.gone, []);
});

test('saveRegistry / readRegistry / formatInventory：临时文件往返', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-reg-')), 'registry.json');
  const registry = {
    updated: new Date().toISOString(),
    skills: {
      'a-skill': { slug: 'a-skill', version: '1.0.0', description: 'A', sources: ['Codex'], status: 'known' },
    },
  };
  const saved = scan.saveRegistry(registry, tmp);
  assert.strictEqual(saved, tmp);
  const back = scan.readRegistry(tmp);
  assert.strictEqual(back.skills['a-skill'].version, '1.0.0');
  const text = scan.formatInventory(registry, tmp);
  assert.ok(text.includes('a-skill'));
  assert.ok(text.includes('v1.0.0'));
  assert.ok(text.includes(tmp));
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});
