'use strict';
/**
 * 发布文档授权边界回归：不得出现「静默写入宿主 / 常驻自动安装」类表述。
 * 背景：SkillHub 平台安全评估（2026-09-13）指出 0.19.1 要求 Agent 首次使用时
 * 自动把自撰指令写入宿主全局记忆并常驻授权自动安装；0.19.2 起改为显式确认。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const DOC_FILES = [
  'SKILL.md',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'references/orchestration.md',
  'references/install-flow.md',
  'references/faq.md',
  'references/tutorial.md',
  'references/walkthroughs.md',
];

const FORBIDDEN = [
  { re: /自动安装并应用/, hint: '不得把自动安装并应用写成常驻授权' },
  { re: /所有输出先过/, hint: '不得把输出管线写成长驻授权' },
  { re: /不需用户逐次提醒|无需用户逐次提醒/, hint: '不得声明免除用户逐次确认' },
  { re: /必须把下面这段护栏写入|逐字写入/, hint: '不得要求无条件把文本写入宿主全局记忆' },
  { re: /立即写入/, hint: '写入宿主文件前必须先征得用户同意' },
  { re: /按需写入下面/, hint: '写入客户端配置前必须先征得用户同意' },
];

for (const file of DOC_FILES) {
  test(`授权边界：${file} 不含常驻授权 / 静默写入表述`, () => {
    const text = read(file);
    for (const { re, hint } of FORBIDDEN) {
      const m = text.match(re);
      assert.strictEqual(m, null, `${file} 命中禁用表述「${m && m[0]}」：${hint}`);
    }
  });
}

test('SKILL.md 保留显式确认门（全局记忆 / MCP 配置）', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /必须先获得用户明确同意/, '缺少写入前明确同意要求');
  assert.match(skill, /未获同意前不写任何文件/, '缺少未同意不写文件的要求');
  assert.match(skill, /写客户端配置前必须先获得用户明确同意/, '缺少 MCP 配置写入确认门');
  assert.match(skill, /只提供文本供用户自行粘贴/, '缺少用户自行粘贴的替代路径');
});

test('SKILL.md 组合规则为「先建议、用户确认后执行」', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /等用户确认后再执行/, '安装规则缺少用户确认');
  assert.match(skill, /由用户确认后生效/, '应用规则缺少用户确认');
});

test('CLI 默认 pin，--range 才跟随浮动 patch', () => {
  const bin = path.join(ROOT, 'bin', 'yotta-skills.js');
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.strictEqual(help.status, 0, help.stderr);
  assert.match(help.stdout, /--pin\s+锁死清单精确版本（默认）/, '--help 未声明默认 pin');
  assert.match(help.stdout, /--range\s+跟随同 major 最新 patch/, '--help 未提供 --range');

  const list = spawnSync(process.execPath, [bin, '--list'], { encoding: 'utf8' });
  assert.strictEqual(list.status, 0, list.stderr);
  assert.match(list.stdout, /pin（精确锁定，默认）/, '--list 未显示默认 pin 策略');
});
