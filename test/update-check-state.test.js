'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const updateCheck = require('../lib/update-check');

const DAY = 24 * 60 * 60 * 1000;

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ys-update-state-'));
}

test('空缓存视为到期', () => {
  assert.strictEqual(updateCheck.isDue(null, Date.now()), true);
});

test('未到期的记录不触发检查', () => {
  const now = Date.now();
  assert.strictEqual(updateCheck.isDue({ next_check: new Date(now + 60 * 1000).toISOString() }, now), false);
});

test('到期边界触发检查', () => {
  const now = Date.now();
  assert.strictEqual(updateCheck.isDue({ next_check: new Date(now).toISOString() }, now), true);
});

test('损坏的 next_check 视为到期', () => {
  assert.strictEqual(updateCheck.isDue({ next_check: 'not-a-date' }, Date.now()), true);
});

test('周检加入 0 到 24 小时随机抖动', () => {
  const now = Date.UTC(2026, 8, 13, 0, 0, 0);
  assert.strictEqual(
    updateCheck.nextCheckAt(now, () => 0),
    new Date(now + 7 * DAY).toISOString(),
  );
  assert.strictEqual(
    updateCheck.nextCheckAt(now, () => 0.5),
    new Date(now + 7 * DAY + 12 * 60 * 60 * 1000).toISOString(),
  );
  assert.strictEqual(
    updateCheck.nextCheckAt(now, () => 1),
    new Date(now + 8 * DAY).toISOString(),
  );
});

test('缓存损坏时回退为空缓存', () => {
  const home = tmpHome();
  const file = updateCheck.cachePath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{broken', 'utf8');

  assert.deepStrictEqual(updateCheck.readCache(home), { version: 1, targets: {} });
});

test('检查结果按目标目录隔离写入缓存', () => {
  const home = tmpHome();
  const now = Date.UTC(2026, 8, 13, 0, 0, 0);
  const result = { updates: 1, latest: 2, failed: 0, nonFamily: 0, rows: [] };

  updateCheck.recordCheck(home, path.join(home, 'skills-a'), {
    now,
    random: () => 0,
    result,
  });
  updateCheck.recordCheck(home, path.join(home, 'skills-b'), {
    now,
    random: () => 0.5,
    result: { updates: 0, latest: 2, failed: 0, nonFamily: 0, rows: [] },
  });

  const cache = updateCheck.readCache(home);
  assert.deepStrictEqual(Object.keys(cache.targets).length, 2);

  const first = cache.targets[updateCheck.targetKey(path.join(home, 'skills-a'))];
  const second = cache.targets[updateCheck.targetKey(path.join(home, 'skills-b'))];
  assert.strictEqual(first.last_result.updates, 1);
  assert.strictEqual(first.last_error, null);
  assert.strictEqual(first.next_check, new Date(now + 7 * DAY).toISOString());
  assert.strictEqual(second.last_result.updates, 0);
  assert.strictEqual(second.next_check, new Date(now + 7 * DAY + 12 * 60 * 60 * 1000).toISOString());
});
