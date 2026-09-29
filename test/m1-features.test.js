'use strict';

const test = require('node:test');
const assert = require('node:assert');

const features = require('../lib/m1-features');

test('buildFeatureSnapshot：只输出评分需要的元数据与聚合计数', () => {
  const snapshot = features.buildFeatureSnapshot({
    skills: {
      'yotta-memory': {
        slug: 'yotta-memory',
        version: '0.19.0',
        status: 'known',
        description: '文件式跨会话记忆，适合开工恢复上下文。',
        first_seen: '2026-08-23T00:00:00Z',
        last_seen: '2026-09-30T00:00:00Z',
        source_dirs: ['D:/secret/path'],
        sources: ['Codex'],
        pinned: true,
      },
      'yotta-gone': {
        slug: 'yotta-gone',
        version: '1.0.0',
        status: 'gone',
        description: '已消失的技能。',
        first_seen: '2026-09-01T00:00:00Z',
        last_seen: '2026-09-29T00:00:00Z',
      },
    },
  }, {
    skills: {
      'yotta-memory': {
        used: 2,
        named: 1,
        accepted: 0,
        route_hits: 5,
        last_signal_at: '2026-09-30T00:00:00Z',
        pairs: { 'yotta-workflow': 3, 'yotta-learn': 1 },
      },
    },
  }, { now: '2026-09-30T00:00:00Z' });

  assert.strictEqual(snapshot.schema, 1);
  assert.strictEqual(snapshot.generated_at, '2026-09-30T00:00:00Z');
  assert.deepStrictEqual(snapshot.skills.map((s) => s.slug), ['yotta-gone', 'yotta-memory']);
  const memory = snapshot.skills.find((s) => s.slug === 'yotta-memory');
  assert.strictEqual(memory.version, '0.19.0');
  assert.strictEqual(memory.status, 'known');
  assert.strictEqual(memory.pinned, true);
  assert.strictEqual(memory.signals.used, 2);
  assert.strictEqual(memory.signals.named, 1);
  assert.strictEqual(memory.signals.route_hits, 5);
  assert.strictEqual(memory.signals.distinct_pairs, 2);
  assert.ok(!JSON.stringify(snapshot).includes('D:/secret/path'));
  assert.ok(!JSON.stringify(snapshot).includes('Codex'));
});

test('buildFeatureSnapshot：缺记录时计数归零，gone 状态保留', () => {
  const snapshot = features.buildFeatureSnapshot({
    skills: {
      'yotta-gone': {
        slug: 'yotta-gone',
        status: 'gone',
        version: '',
        description: '',
        first_seen: '',
        last_seen: '',
      },
    },
  }, {}, { now: '2026-09-30T00:00:00Z' });
  assert.strictEqual(snapshot.skills.length, 1);
  assert.strictEqual(snapshot.skills[0].signals.used, 0);
  assert.strictEqual(snapshot.skills[0].signals.distinct_pairs, 0);
  assert.strictEqual(snapshot.skills[0].status, 'gone');
});
