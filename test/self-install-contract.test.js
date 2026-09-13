'use strict';
/**
 * 自装契约回归：本包 manifest 的 before_install 声明必须与安装管线实际提供的检查项对齐。
 * 背景：2026-09-13 实测本包声明 require_tool=install_gate，而安装管线只提供 scan_skill，
 * 导致 yotta-skills 自装被自己的 hook 判为 missing → block（只能靠 --skip-scan 绕过）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const hook = require('../lib/hook-adapter');

const ROOT = path.join(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'skill-manifest.json'), 'utf8'));
const PIPELINE_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'install-pipeline.js'), 'utf8');

function evaluate(ok) {
  return hook.evaluateHook({
    host: 'codex',
    event: 'before_install',
    manifest: MANIFEST,
    capabilities: hook.capabilitiesForHost('codex'),
    // 与 lib/install-pipeline.js 传入的上下文保持同形（含 audit_log 证据）
    context: { wrapperRegistered: true, checks: { scan_skill: { ok, evidence: { audit_log: 'install-log.jsonl' } } } },
  });
}

test('安装管线提供的检查项与自装 manifest 声明一致（scan_skill）', () => {
  const req = (MANIFEST.hooks || []).find((h) => h.event === 'before_install');
  assert.ok(req, 'manifest 缺少 before_install 声明');
  assert.strictEqual(req.require_tool, 'scan_skill', 'require_tool 必须与管线提供的检查项同名');
  assert.match(PIPELINE_SRC, /scan_skill:\s*\{/, '安装管线必须提供 scan_skill 检查项');
});

test('扫描通过（非 DO NOT INSTALL）时自装放行', () => {
  const result = evaluate(true);
  assert.strictEqual(result.decision, 'allow', '扫描通过时不应阻断自装: ' + JSON.stringify(result));
});

test('扫描判定阻断时自装被拦（on_fail=block 生效）', () => {
  const result = evaluate(false);
  assert.strictEqual(result.decision, 'block', '扫描失败时必须阻断: ' + JSON.stringify(result));
});

test('permissions.note 不再触发元信 PIJ-020（下载 / 执行 同时出现）', () => {
  const note = (MANIFEST.permissions || {}).note || '';
  assert.ok(!(note.includes('下载') && note.includes('执行')), 'permissions.note 同时出现「下载」「执行」会误触发 PIJ-020：' + note);
});
