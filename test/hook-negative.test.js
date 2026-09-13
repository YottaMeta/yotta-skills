'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const hook = require('../lib/hook-adapter');

function manifest(hooks) {
  return { slug: 'yotta-negative', name: '负向样例', version: '1.0.0', hooks };
}

function evaluate(input) {
  return hook.evaluateHook(input);
}

test('negative: unsupported host cannot claim verified even with evidence', () => {
  const result = evaluate({
    host: 'unknown-host',
    event: 'before_send',
    manifest: manifest([{
      event: 'before_send',
      require_tool: 'present_result',
      on_fail: 'block',
      evidence: ['tool_call_id'],
    }]),
    context: { checks: { present_result: { ok: true, evidence: { tool_call_id: 'call-1' } } } },
  });
  assert.strictEqual(result.decision, 'unverified');
  assert.strictEqual(result.verified, false);
});

test('negative: fake success without declared evidence is not verified', () => {
  const result = evaluate({
    host: 'codex',
    event: 'after_milestone',
    manifest: manifest([{
      event: 'after_milestone',
      require_action: 'write_state',
      on_fail: 'block',
      evidence: ['file_path'],
    }]),
    context: { checks: { write_state: { ok: true } } },
  });
  assert.strictEqual(result.decision, 'unverified');
  assert.strictEqual(result.verified, false);
});

test('negative: missing tool call becomes explicit-unverified on audit-only host', () => {
  const result = evaluate({
    host: 'codex',
    event: 'before_tool',
    manifest: manifest([{
      event: 'before_tool',
      require_tool: 'guard_check',
      on_fail: 'block',
      evidence: ['audit_log'],
    }]),
    context: {},
  });
  assert.strictEqual(result.decision, 'unverified');
  assert.strictEqual(result.correction, true);
  assert.match(result.user_message, /explicit-unverified/);
});

test('negative: wrapper bypass cannot be reported as enforced', () => {
  const result = evaluate({
    host: 'codex',
    event: 'before_publish',
    manifest: manifest([{
      event: 'before_publish',
      require_tool: 'publish_gate',
      on_fail: 'block',
      fallback: 'wrapper',
      evidence: ['exit_code'],
    }]),
    context: {
      wrapperRegistered: false,
      checks: { publish_gate: { ok: false, evidence: { exit_code: 2 } } },
    },
  });
  assert.strictEqual(result.decision, 'unverified');
  assert.strictEqual(result.verified, false);
});

test('negative: duplicate evaluation is deterministic and never escalates to verified', () => {
  const input = {
    host: 'codex',
    event: 'before_send',
    manifest: manifest([{
      event: 'before_send',
      require_tool: 'present_result',
      on_fail: 'block',
      evidence: ['tool_call_id'],
    }]),
    context: { checks: { present_result: { ok: true, evidence: { tool_call_id: 'call-2' } } } },
  };
  const first = evaluate(input);
  const second = evaluate(input);
  const third = evaluate(input);
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(second, third);
  assert.strictEqual(first.verified, false);
});

test('negative: failed native-block retry stays blocked', () => {
  const input = {
    host: 'synthetic',
    event: 'before_tool',
    capabilities: { ...hook.capabilitiesForHost('generic'), before_tool: 'native-block' },
    manifest: manifest([{
      event: 'before_tool',
      require_tool: 'guard_check',
      on_fail: 'block',
      evidence: ['tool_call_id'],
    }]),
    context: { checks: { guard_check: { ok: false, evidence: { tool_call_id: 'call-3' } } } },
  };
  assert.strictEqual(evaluate(input).decision, 'block');
  assert.strictEqual(evaluate(input).decision, 'block');
  assert.strictEqual(evaluate(input).decision, 'block');
});

test('negative: invalid manifest blocks instead of allowing a forged path', () => {
  const result = evaluate({
    host: 'codex',
    event: 'before_publish',
    manifest: manifest([{
      event: 'before_publish',
      on_fail: 'block',
      evidence: [],
    }]),
    context: { checks: { publish_gate: { ok: true } } },
  });
  assert.strictEqual(result.decision, 'block');
  assert.ok(result.errors.length > 0);
});
