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
