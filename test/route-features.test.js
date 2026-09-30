'use strict';

const test = require('node:test');
const assert = require('node:assert');

const features = require('../lib/route-features');

const PLAYBOOKS = [
  {
    id: 'output-standard',
    name: '输出呈现标准',
    intent: '让输出先判型渲染，再去除 AI 味。',
    keywords: ['输出', '呈现', '润色', 'AI味'],
    skills: [{ slug: 'yotta-present' }, { slug: 'yotta-humanize' }],
  },
  {
    id: 'long-lived-agent',
    name: '长生命周期智能体',
    intent: '跨会话恢复状态与记忆。',
    keywords: ['记忆', '跨会话', '上下文'],
    skills: [{ slug: 'yotta-memory' }],
  },
];

function registry() {
  return {
    skills: {
      'yotta-present': {
        slug: 'yotta-present',
        version: '0.6.6',
        description: '输出呈现：把 AI 输出渲染为可复制格式；边界：不做内容判断。',
        status: 'known',
        sources: ['Codex'],
        source_dirs: ['D:/secret/path/yotta-present'],
        first_seen: '2026-08-23T00:00:00Z',
        last_seen: '2026-10-01T00:00:00Z',
      },
      'yotta-memory': {
        slug: 'yotta-memory',
        version: '0.20.0',
        description: '文件式跨会话记忆；边界：数据不出本机。',
        status: 'known',
        sources: ['OpenCode'],
        source_dirs: ['D:/secret/path/yotta-memory'],
        first_seen: '2026-08-23T00:00:00Z',
        last_seen: '2026-10-01T00:00:00Z',
      },
      'third-party': {
        slug: 'third-party',
        version: '1.0.0',
        description: '第三方技能',
        status: 'known',
        sources: ['Cursor'],
        source_dirs: ['D:/secret/path/third-party'],
        first_seen: '2026-09-01T00:00:00Z',
        last_seen: '2026-10-01T00:00:00Z',
      },
      'gone-skill': {
        slug: 'gone-skill',
        status: 'gone',
      },
    },
  };
}

test('englishTokens：过滤停用词、去重、保持顺序', () => {
  assert.deepStrictEqual(
    features.englishTokens('Please use the release quality checker and release notes'),
    ['please', 'use', 'release', 'quality', 'checker', 'notes'],
  );
});

test('cjkBigrams：连续中文片段生成相邻 bigram 并去重', () => {
  assert.deepStrictEqual(features.cjkBigrams('发布前质量检查，发布质量'), [
    '发布', '布前', '前质', '质量', '量检', '检查', '布质',
  ]);
});

test('playbookMatches：按命中分数排序并返回命中关键词', () => {
  const matches = features.playbookMatches('帮我润色输出，别有 AI味，顺便做发布质量检查', PLAYBOOKS);
  assert.strictEqual(matches[0].id, 'output-standard');
  assert.deepStrictEqual(matches[0].matched_keywords, ['输出', '润色', 'AI味']);
  assert.ok(matches[0].score >= 4);
});

test('buildRouteFeatures：usage disabled 时为空，且不含路径 / source_dirs', () => {
  const payload = features.buildRouteFeatures({
    request: '帮我润色输出',
    registry: registry(),
    staticResult: {
      playbook: { id: 'output-standard' },
      confidence: 'high',
      skills: [{ slug: 'yotta-present' }, { slug: 'yotta-humanize' }],
    },
    usage: { enabled: false, skills: { 'yotta-memory': { used: 9 } } },
    playbooks: PLAYBOOKS,
  });
  assert.strictEqual(payload.schema, 2);
  assert.strictEqual(payload.usage.enabled, false);
  assert.deepStrictEqual(payload.usage.skills, {});
  assert.strictEqual(payload.installed_skills.length, 3);
  assert.ok(!JSON.stringify(payload).includes('source_dirs'));
  assert.ok(!JSON.stringify(payload).includes('D:/secret/path'));
  assert.strictEqual(payload.installed_skills.find((s) => s.slug === 'yotta-present').trust, 'yottameta');
  assert.strictEqual(payload.installed_skills.find((s) => s.slug === 'third-party').trust, 'third-party');
});

test('buildRouteFeatures：usage enabled 时聚合 distinct_pairs，且不发送 pairs 原文', () => {
  const payload = features.buildRouteFeatures({
    request: '跨会话记忆',
    registry: registry(),
    staticResult: {
      playbook: { id: 'long-lived-agent' },
      confidence: 'medium',
      skills: [{ slug: 'yotta-memory' }],
    },
    usage: {
      enabled: true,
      skills: {
        'yotta-memory': {
          used: 2,
          named: 1,
          accepted: 1,
          route_hits: 5,
          pairs: { 'yotta-workflow': 3, 'yotta-present': 1 },
          last_signal_at: '2026-09-30T00:00:00Z',
        },
      },
      last_route: {
        at: '2026-09-30T00:00:00Z',
        playbook: 'long-lived-agent',
        confidence: 'medium',
        skills: ['yotta-memory', 'yotta-workflow'],
      },
    },
    playbooks: PLAYBOOKS,
  });
  assert.strictEqual(payload.usage.enabled, true);
  assert.deepStrictEqual(payload.usage.skills['yotta-memory'], {
    used: 2,
    named: 1,
    accepted: 1,
    route_hits: 5,
    distinct_pairs: 2,
    last_signal_at: '2026-09-30T00:00:00Z',
  });
  assert.ok(!JSON.stringify(payload.usage.skills).includes('yotta-workflow":3'));
  assert.deepStrictEqual(payload.usage.last_route.skills, ['yotta-memory', 'yotta-workflow']);
});

test('buildRouteFeatures：playbooks 只保留公开元数据', () => {
  const payload = features.buildRouteFeatures({
    request: '输出',
    registry: registry(),
    staticResult: { playbook: { id: 'output-standard' }, confidence: 'high', skills: [] },
    usage: { enabled: false },
    playbooks: PLAYBOOKS,
  });
  assert.deepStrictEqual(payload.playbooks[0], {
    id: 'output-standard',
    name: '输出呈现标准',
    intent: '让输出先判型渲染，再去除 AI 味。',
    keywords: ['输出', '呈现', '润色', 'AI味'],
    skills: ['yotta-present', 'yotta-humanize'],
  });
});
