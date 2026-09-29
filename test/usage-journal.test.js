'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../lib/usage-journal');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-usage-'));
}

test('缺失文件：返回默认关闭状态，不创建文件', () => {
  const home = tempHome();
  try {
    const state = usage.readUsage({ homeDir: home });
    assert.strictEqual(state.enabled, false);
    assert.deepStrictEqual(state.skills, {});
    assert.ok(!fs.existsSync(usage.usageFilePath({ homeDir: home })));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('enable / disable：写入状态文件并保持计数', () => {
  const home = tempHome();
  try {
    usage.setEnabled(true, { homeDir: home });
    usage.markUsage('yotta-memory', 'used', { homeDir: home });
    usage.setEnabled(false, { homeDir: home });
    const state = usage.readUsage({ homeDir: home });
    assert.strictEqual(state.enabled, false);
    assert.strictEqual(state.skills['yotta-memory'].used, 1);
    assert.ok(fs.existsSync(usage.usageFilePath({ homeDir: home })));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('recordRoute：关闭时不写文件', () => {
  const home = tempHome();
  try {
    const result = usage.recordRoute({
      playbook: 'long-lived-agent',
      confidence: 'high',
      skills: ['yotta-memory', 'yotta-workflow'],
    }, { homeDir: home });
    assert.strictEqual(result.recorded, false);
    assert.strictEqual(result.reason, 'disabled');
    assert.ok(!fs.existsSync(usage.usageFilePath({ homeDir: home })));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('recordRoute：开启后累计 route_hits 与组合对，不记录需求原文', () => {
  const home = tempHome();
  try {
    usage.setEnabled(true, { homeDir: home });
    const result = usage.recordRoute({
      playbook: 'long-lived-agent',
      confidence: 'high',
      skills: ['yotta-memory', 'yotta-workflow', 'yotta-learn'],
    }, { homeDir: home });
    assert.strictEqual(result.recorded, true);
    const state = usage.readUsage({ homeDir: home });
    assert.strictEqual(state.skills['yotta-memory'].route_hits, 1);
    assert.strictEqual(state.skills['yotta-memory'].pairs['yotta-workflow'], 1);
    assert.strictEqual(state.skills['yotta-memory'].pairs['yotta-learn'], 1);
    assert.strictEqual(state.skills['yotta-workflow'].pairs['yotta-learn'], 1);
    assert.strictEqual(state.last_route.playbook, 'long-lived-agent');
    assert.strictEqual(state.last_route.confidence, 'high');
    assert.ok(!JSON.stringify(state).includes('需求'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('markUsage：显式信号在关闭状态下也可记录，并更新时间', () => {
  const home = tempHome();
  try {
    usage.markUsage('yotta-memory', 'named', { homeDir: home });
    usage.markUsage('yotta-memory', 'accepted', { homeDir: home });
    const state = usage.readUsage({ homeDir: home });
    assert.strictEqual(state.skills['yotta-memory'].named, 1);
    assert.strictEqual(state.skills['yotta-memory'].accepted, 1);
    assert.ok(state.skills['yotta-memory'].last_signal_at);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('markUsage：非法 slug / signal 拒绝写入', () => {
  const home = tempHome();
  try {
    assert.throws(() => usage.markUsage('bad skill', 'used', { homeDir: home }), /slug/);
    assert.throws(() => usage.markUsage('yotta-memory', 'other', { homeDir: home }), /signal/);
    assert.ok(!fs.existsSync(usage.usageFilePath({ homeDir: home })));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('损坏文件：回退默认状态，不抛异常', () => {
  const home = tempHome();
  try {
    const file = usage.usageFilePath({ homeDir: home });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not-json', 'utf8');
    const state = usage.readUsage({ homeDir: home });
    assert.strictEqual(state.enabled, false);
    assert.deepStrictEqual(state.skills, {});
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('resetUsage：删除记录文件', () => {
  const home = tempHome();
  try {
    usage.markUsage('yotta-memory', 'used', { homeDir: home });
    assert.ok(fs.existsSync(usage.usageFilePath({ homeDir: home })));
    usage.resetUsage({ homeDir: home });
    assert.ok(!fs.existsSync(usage.usageFilePath({ homeDir: home })));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
