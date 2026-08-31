'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  routeRequest,
  PLAYBOOKS,
} = require('../lib/route');

function registryWith(...slugs) {
  return {
    skills: Object.fromEntries(slugs.map((slug) => [
      slug,
      { slug, version: '1.0.0', sources: ['Codex'], status: 'known' },
    ])),
  };
}

test('playbooks：七大静态场景完整且技能顺序明确', () => {
  assert.strictEqual(PLAYBOOKS.length, 7);
  assert.deepStrictEqual(
    PLAYBOOKS.map((p) => p.id),
    [
      'output-standard',
      'long-lived-agent',
      'delivery-quality-gate',
      'preinstall-security-gate',
      'skill-build-publish',
      'security-incident-response',
      'entry-install',
    ],
  );
  for (const playbook of PLAYBOOKS) {
    assert.ok(playbook.name);
    assert.ok(playbook.intent);
    assert.ok(Array.isArray(playbook.keywords) && playbook.keywords.length >= 3);
    assert.ok(Array.isArray(playbook.skills) && playbook.skills.length >= 2);
    assert.deepStrictEqual(
      playbook.skills.map((s) => s.order),
      playbook.skills.map((_, i) => i + 1),
    );
  }
});

test('routeRequest：输出呈现场景命中组合并保持调用顺序', () => {
  const result = routeRequest('帮我润色这段输出，要规范可复制，别有 AI 味', {
    registry: registryWith('yotta-present'),
  });
  assert.strictEqual(result.playbook.id, 'output-standard');
  assert.strictEqual(result.confidence, 'high');
  assert.deepStrictEqual(result.skills.map((s) => s.slug), ['yotta-present', 'yotta-humanize']);
  assert.strictEqual(result.skills[0].installed, true);
  assert.strictEqual(result.skills[1].installed, false);
  assert.strictEqual(result.skills[1].role.length > 0, true);
});

test('routeRequest：缺失技能只建议安装，不自动安装', () => {
  const result = routeRequest('检查这段代码质量，别糊弄，发布前也要守门', {
    registry: registryWith('yotta-code-quality'),
  });
  assert.strictEqual(result.playbook.id, 'delivery-quality-gate');
  assert.deepStrictEqual(result.missing_skills.map((s) => s.slug), ['yotta-anti-shallow', 'yotta-publish-guard']);
  assert.strictEqual(result.install_command,
    'npx -y @yottameta/yotta-skills install yotta-anti-shallow yotta-publish-guard --dir <skills-dir>');
  assert.strictEqual(result.missing_skills[0].scan_required, true);
  assert.strictEqual(result.auto_install, false);
});

test('routeRequest：无匹配时低置信度回退到入口+安装组合', () => {
  const result = routeRequest('今天天气怎么样', { registry: registryWith() });
  assert.strictEqual(result.playbook.id, 'entry-install');
  assert.strictEqual(result.confidence, 'low');
  assert.deepStrictEqual(result.matched_keywords, []);
  assert.ok(result.disclaimer.includes('路由建议不保证完全正确'));
});

test('routeRequest：应用模式默认显式调用并提示可切换', () => {
  const result = routeRequest('让 AI 长期帮我做项目，别忘了我，跨会话', {
    registry: registryWith('yotta-workflow', 'yotta-memory', 'yotta-learn', 'yotta-logs'),
  });
  assert.strictEqual(result.application_mode.default, 'explicit');
  assert.deepStrictEqual(result.application_mode.options, ['explicit', 'scene-auto']);
  assert.ok(result.application_mode.note.includes('需要用户确认'));
  assert.strictEqual(result.missing_skills.length, 0);
});


test('routeRequest：其他已装技能候选——非元技能按 description 机械匹配 Top N', () => {
  const registry = {
    skills: {
      'yotta-present': { slug: 'yotta-present', version: '0.1.1', sources: ['Codex'], status: 'known' },
      'fake-log-analyzer': {
        slug: 'fake-log-analyzer', version: '2.1.0', description: '分析安全日志并聚合告警',
        sources: ['Claude Code'], status: 'known',
      },
      'fake-weather': {
        slug: 'fake-weather', version: '1.0.0', description: '查询天气',
        sources: ['Cursor'], status: 'known',
      },
    },
  };
  const result = routeRequest('帮我分析日志，看有没有攻击', { registry });
  assert.strictEqual(result.playbook.id, 'security-incident-response');
  assert.ok(Array.isArray(result.other_skill_candidates));
  const top = result.other_skill_candidates[0];
  assert.strictEqual(top.slug, 'fake-log-analyzer');
  assert.ok(top.score >= 1);
  assert.ok(top.matched_terms.length >= 1);
  assert.ok(top.matched_terms.includes('分析'));
  assert.strictEqual(top.scan_status, 'not_scanned');
  assert.deepStrictEqual(top.sources, ['Claude Code']);
  assert.strictEqual(top.version, '2.1.0');
  assert.ok(top.note.includes('不读取全文指令'));
  assert.ok(top.note.includes('装前安全扫描'));
  assert.ok(result.other_skills_note.includes('数据不出本机'));
  assert.ok(!result.other_skill_candidates.some((c) => c.slug === 'fake-weather'));
});

test('routeRequest：元技能不进其他已装技能候选', () => {
  const registry = {
    skills: {
      'yotta-memory': { slug: 'yotta-memory', version: '0.8.5', description: '按权限边界保存与恢复跨会话记忆', sources: ['Codex'], status: 'known' },
      'yotta-chart': { slug: 'yotta-chart', version: '0.1.0', description: '本地零依赖可视化图表', sources: ['Codex'], status: 'known' },
      'other-brand': { slug: 'other-brand', version: '1.0.0', description: '跨会话记忆助手', sources: ['Cursor'], status: 'known' },
    },
  };
  const result = routeRequest('帮我记住这个，跨会话', { registry });
  assert.deepStrictEqual(result.other_skill_candidates.map((c) => c.slug), ['other-brand']);
  const result2 = routeRequest('帮我记住这个，跨会话', { registry, yottaSlugs: ['yotta-memory', 'yotta-chart', 'other-brand'] });
  assert.deepStrictEqual(result2.other_skill_candidates, []);
});

test('routeRequest：候选数量受 Top N 限制并按得分排序（确定性）', () => {
  const skills = {};
  for (let i = 1; i <= 5; i++) {
    skills['fake-a' + i] = { slug: 'fake-a' + i, version: '1.0.0', description: '日志分析 攻击检测 安全告警', sources: ['Codex'], status: 'known' };
  }
  const registry = { skills };
  const result = routeRequest('分析日志检测攻击', { registry });
  assert.strictEqual(result.other_skill_candidates.length, 3);
  for (const c of result.other_skill_candidates) assert.ok(c.score >= 1);
  const scores = result.other_skill_candidates.map((c) => c.score);
  assert.deepStrictEqual(scores, [...scores].sort((a, b) => b - a));
  const again = routeRequest('分析日志检测攻击', { registry });
  assert.deepStrictEqual(again.other_skill_candidates, result.other_skill_candidates);
  const result2 = routeRequest('分析日志检测攻击', { registry, otherSkillsTopN: 1 });
  assert.strictEqual(result2.other_skill_candidates.length, 1);
});

test('routeRequest：无匹配或空注册表时其他候选为空数组', () => {
  const empty = routeRequest('今天天气怎么样', { registry: { skills: {} } });
  assert.deepStrictEqual(empty.other_skill_candidates, []);
  const reg = {
    skills: {
      'fake-bug-fixer': { slug: 'fake-bug-fixer', version: '1.0.0', description: '定位并修复软件缺陷', sources: ['Cursor'], status: 'known' },
    },
  };
  const noMatch = routeRequest('今天天气怎么样', { registry: reg });
  assert.deepStrictEqual(noMatch.other_skill_candidates, []);
});
