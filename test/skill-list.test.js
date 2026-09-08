'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.json'), 'utf8'));
const doc = fs.readFileSync(path.join(ROOT, 'references', 'skill-list.md'), 'utf8');

function parseSkillList() {
  const rows = new Map();
  for (const line of doc.split(/\r?\n/)) {
    if (!line.startsWith('| `yotta-')) continue;
    const cells = line.split('|').map((s) => s.trim());
    if (cells.length < 6) continue;
    const slug = cells[1].replace(/^`|`$/g, '');
    const version = cells[4];
    rows.set(slug, version);
  }
  return rows;
}

test('skill-list.md 与 skills.json 的技能集合一致', () => {
  const rows = parseSkillList();
  assert.deepStrictEqual([...rows.keys()].sort(), manifest.skills.map((s) => s.slug).sort());
});

test('skill-list.md 与 skills.json 的版本一致', () => {
  const rows = parseSkillList();
  for (const skill of manifest.skills) {
    assert.strictEqual(rows.get(skill.slug), skill.version, `${skill.slug} 清单版本漂移`);
  }
});
