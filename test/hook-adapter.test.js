'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../lib/hook-adapter');

function manifest(hooks) {
  return {
    slug: 'yotta-demo',
    name: '元示例',
    version: '1.0.0',
    hooks: hooks || [],
  };
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ys-hook-home-'));
}

test('Codex capability matrix matches the published contract', () => {
  assert.deepStrictEqual(hook.capabilitiesForHost('codex'), {
    before_start: 'native-audit',
    before_tool: 'native-audit',
    before_install: 'wrapper-only',
    before_publish: 'wrapper-only',
    after_milestone: 'native-audit',
    before_send: 'unsupported',
  });
});

test('unknown hosts stay unsupported until explicitly verified', () => {
  const caps = hook.capabilitiesForHost('generic-unknown-host');
  for (const event of hook.EVENTS) assert.strictEqual(caps[event], 'unsupported');
});

test('valid hook declarations preserve schema fields', () => {
  const result = hook.validateHookRequirements(manifest([{
    event: 'before_install',
    require_tool: 'scan_skill',
    condition: '安装前',
    on_fail: 'block',
    fallback: 'wrapper',
    evidence: ['tool_call_id', 'audit_log'],
  }]));
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.requirements.length, 1);
  assert.strictEqual(result.requirements[0].require_tool, 'scan_skill');
});

test('invalid hook declarations are rejected with actionable errors', () => {
  const result = hook.validateHookRequirements(manifest([
    { event: 'bad-event', on_fail: 'block', evidence: ['tool_call_id'] },
    { event: 'before_send', on_fail: 'block', evidence: [] },
    { event: 'before_tool', on_fail: 'block', evidence: ['model_claim'] },
    { event: 'before_tool', on_fail: 'block', evidence: ['tool_call_id'] },
  ]));
  assert.ok(result.errors.some((x) => x.includes('event')));
  assert.ok(result.errors.some((x) => x.includes('evidence')));
  assert.ok(result.errors.some((x) => x.includes('require_tool')));
});

function decision(options) {
  return hook.evaluateHook({
    host: options.host || 'codex',
    event: options.event,
    capabilities: options.capabilities,
    manifest: manifest(options.hooks),
    context: options.context || {},
  });
}

test('native-block blocks a failed requirement and keeps evidence', () => {
  const result = decision({
    event: 'before_tool',
    capabilities: { ...hook.capabilitiesForHost('generic'), before_tool: 'native-block' },
    hooks: [{
      event: 'before_tool',
      require_tool: 'guard',
      on_fail: 'block',
      evidence: ['tool_call_id'],
    }],
    context: { checks: { guard: { ok: false, evidence: { tool_call_id: 'call-1' } } } },
  });
  assert.strictEqual(result.decision, 'block');
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.results[0].capability, 'native-block');
  assert.strictEqual(result.evidence[0].evidence.tool_call_id, 'call-1');
});

test('native-audit failure becomes explicit-unverified with one correction', () => {
  const result = decision({
    event: 'before_tool',
    capabilities: hook.capabilitiesForHost('codex'),
    hooks: [{
      event: 'before_tool',
      require_tool: 'guard',
      on_fail: 'block',
      evidence: ['tool_call_id'],
    }],
    context: { checks: { guard: { ok: false, evidence: { tool_call_id: 'call-2' } } } },
  });
  assert.strictEqual(result.decision, 'unverified');
  assert.strictEqual(result.correction, true);
  assert.match(result.user_message, /explicit-unverified/);
});

test('wrapper-only blocks only when the wrapper path is registered', () => {
  const input = {
    event: 'before_install',
    hooks: [{
      event: 'before_install',
      require_tool: 'scan_skill',
      on_fail: 'block',
      fallback: 'wrapper',
      evidence: ['audit_log'],
    }],
    context: { checks: { scan_skill: { ok: false, evidence: { audit_log: '/tmp/audit.jsonl' } } } },
    capabilities: { ...hook.capabilitiesForHost('generic'), before_install: 'wrapper-only' },
  };
  assert.strictEqual(decision({ ...input, context: { ...input.context, wrapperRegistered: false } }).decision, 'unverified');
  assert.strictEqual(decision({ ...input, context: { ...input.context, wrapperRegistered: true } }).decision, 'block');
});

test('unsupported hosts never report verified enforcement', () => {
  const result = decision({
    host: 'unknown-host',
    event: 'before_send',
    hooks: [{
      event: 'before_send',
      require_tool: 'present_result',
      on_fail: 'block',
      fallback: 'explicit-unverified',
      evidence: ['tool_call_id'],
    }],
    context: { checks: { present_result: { ok: true, evidence: { tool_call_id: 'call-3' } } } },
  });
  assert.strictEqual(result.decision, 'unverified');
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.results[0].capability, 'unsupported');
});

test('multiple requirements preserve order and any block wins', () => {
  const result = decision({
    event: 'before_tool',
    capabilities: { ...hook.capabilitiesForHost('generic'), before_tool: 'native-block' },
    hooks: [
      { event: 'before_tool', require_tool: 'first', on_fail: 'warn', evidence: ['tool_call_id'] },
      { event: 'before_tool', require_tool: 'second', on_fail: 'block', evidence: ['tool_call_id'] },
    ],
    context: {
      checks: {
        first: { ok: false, evidence: { tool_call_id: 'call-4' } },
        second: { ok: false, evidence: { tool_call_id: 'call-5' } },
      },
    },
  });
  assert.strictEqual(result.decision, 'block');
  assert.deepStrictEqual(result.results.map((x) => x.action), ['first', 'second']);
});

test('passing checks require declared evidence before verified=true', () => {
  const hooks = [{
    event: 'after_milestone',
    require_action: 'write_state',
    on_fail: 'block',
    evidence: ['file_path'],
  }];
  const withoutEvidence = decision({
    event: 'after_milestone',
    hooks,
    context: { checks: { write_state: { ok: true } } },
  });
  assert.strictEqual(withoutEvidence.verified, false);
  assert.strictEqual(withoutEvidence.decision, 'unverified');

  const withEvidence = decision({
    event: 'after_milestone',
    hooks,
    context: { checks: { write_state: { ok: true, evidence: { file_path: '.workflow/STATE.md' } } } },
  });
  assert.strictEqual(withEvidence.verified, true);
  assert.strictEqual(withEvidence.decision, 'allow');
  assert.strictEqual(withEvidence.evidence[0].evidence.file_path, '.workflow/STATE.md');
});

test('hook evidence appends one JSONL record without requiring success', () => {
  const home = tmpHome();
  const file = hook.appendHookEvidence({
    event: 'before_tool',
    skill: 'yotta-demo',
    action: 'guard',
    result: 'unverified',
    evidence: { tool_call_id: 'call-6' },
  }, { homeDir: home });
  hook.appendHookEvidence({
    event: 'before_tool',
    skill: 'yotta-demo',
    action: 'guard',
    result: 'block',
    evidence: {},
  }, { homeDir: home });
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].result, 'unverified');
  assert.strictEqual(rows[1].result, 'block');
});

test('hook bindings are idempotent and can be removed independently', () => {
  const home = tmpHome();
  const adapter = hook.createHookAdapter({ host: 'codex', homeDir: home });
  const hooks = [
    { event: 'before_install', require_tool: 'scan_skill', on_fail: 'block', evidence: ['audit_log'] },
    { event: 'before_publish', require_action: 'run_gate', on_fail: 'block', evidence: ['exit_code'] },
  ];
  const first = adapter.bind(manifest(hooks));
  const second = adapter.bind(manifest(hooks));
  assert.deepStrictEqual(first.map((x) => x.id), second.map((x) => x.id));
  assert.strictEqual(adapter.listBindings().length, 2);
  assert.strictEqual(adapter.unbind(first[0].id), true);
  assert.strictEqual(adapter.listBindings().length, 1);
  assert.strictEqual(adapter.unbind('missing-binding'), false);
});

test('adapter evaluate uses the selected host capabilities', () => {
  const adapter = hook.createHookAdapter({ host: 'codex', homeDir: tmpHome() });
  const result = adapter.evaluate('before_send', manifest([{
    event: 'before_send',
    require_tool: 'present_result',
    on_fail: 'block',
    evidence: ['tool_call_id'],
  }]), {
    checks: { present_result: { ok: true, evidence: { tool_call_id: 'call-7' } } },
  });
  assert.strictEqual(result.decision, 'unverified');
  assert.strictEqual(result.results[0].capability, 'unsupported');
});
