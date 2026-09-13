'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, home) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
    },
  });
}

function writeManifest(file, hooks) {
  fs.writeFileSync(file, JSON.stringify({
    slug: 'yotta-demo',
    name: '元示例',
    version: '1.0.0',
    hooks,
  }, null, 2), 'utf8');
}

test('hook capabilities outputs the host matrix as JSON', () => {
  const home = tmpDir('ys-hook-cli-home-');
  const r = run(['hook', 'capabilities', '--host', 'codex', '--json'], home);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.host, 'codex');
  assert.strictEqual(payload.capabilities.before_send, 'unsupported');
  assert.strictEqual(payload.capabilities.before_install, 'wrapper-only');
});

test('hook evaluate returns explicit-unverified on unsupported Codex before_send', () => {
  const home = tmpDir('ys-hook-cli-home-');
  const manifest = path.join(home, 'manifest.json');
  writeManifest(manifest, [{
    event: 'before_send',
    require_tool: 'present_result',
    on_fail: 'block',
    evidence: ['tool_call_id'],
  }]);
  const r = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'before_send',
    '--manifest', manifest,
    '--context', JSON.stringify({ checks: { present_result: { ok: true, evidence: { tool_call_id: 'call-1' } } } }),
    '--json',
  ], home);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.decision, 'unverified');
  assert.strictEqual(payload.verified, false);
  assert.strictEqual(payload.results[0].capability, 'unsupported');
  const log = fs.readFileSync(path.join(home, '.yottaskills', 'hook-log.jsonl'), 'utf8');
  assert.match(log, /"result":"unverified"/);
});

test('hook evaluate blocks a failed wrapper-only requirement with exit code 3', () => {
  const home = tmpDir('ys-hook-cli-home-');
  const manifest = path.join(home, 'manifest.json');
  writeManifest(manifest, [{
    event: 'before_install',
    require_tool: 'scan_skill',
    on_fail: 'block',
    fallback: 'wrapper',
    evidence: ['audit_log'],
  }]);
  const r = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'before_install',
    '--manifest', manifest,
    '--context', JSON.stringify({
      wrapperRegistered: true,
      checks: { scan_skill: { ok: false, evidence: { audit_log: '/tmp/audit.jsonl' } } },
    }),
    '--json',
  ], home);
  assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).decision, 'block');
});

test('hook bind is idempotent and hook unbind removes the record', () => {
  const home = tmpDir('ys-hook-cli-home-');
  const manifest = path.join(home, 'manifest.json');
  writeManifest(manifest, [{
    event: 'before_publish',
    require_action: 'run_gate',
    on_fail: 'block',
    evidence: ['exit_code'],
  }]);
  const first = run(['hook', 'bind', '--host', 'codex', '--manifest', manifest, '--json'], home);
  const second = run(['hook', 'bind', '--host', 'codex', '--manifest', manifest, '--json'], home);
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  assert.strictEqual(second.status, 0, second.stdout + second.stderr);
  const firstPayload = JSON.parse(first.stdout);
  const secondPayload = JSON.parse(second.stdout);
  assert.strictEqual(firstPayload.bindings.length, 1);
  assert.deepStrictEqual(firstPayload.bindings.map((x) => x.id), secondPayload.bindings.map((x) => x.id));
  const id = firstPayload.bindings[0].id;
  const removed = run(['hook', 'unbind', id, '--json'], home);
  assert.strictEqual(removed.status, 0, removed.stdout + removed.stderr);
  assert.strictEqual(JSON.parse(removed.stdout).removed, true);
});

test('hook rejects an event without a manifest', () => {
  const home = tmpDir('ys-hook-cli-home-');
  const r = run(['hook', 'evaluate', '--host', 'codex', '--event', 'before_send'], home);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /manifest/);
});

test('yotta-present before_send pilot records explicit-unverified on Codex', () => {
  const home = tmpDir('ys-hook-present-');
  const manifest = path.join(ROOT, '..', 'yotta-present', 'skill-manifest.json');
  const r = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'before_send',
    '--manifest', manifest,
    '--context', JSON.stringify({
      checks: { present_result: { ok: true, evidence: { tool_call_id: 'call-present' } } },
    }),
    '--json',
  ], home);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.decision, 'unverified');
  assert.strictEqual(payload.verified, false);
  assert.strictEqual(payload.results[0].capability, 'unsupported');
  assert.match(payload.user_message, /explicit-unverified/);
  const log = fs.readFileSync(path.join(home, '.yottaskills', 'hook-log.jsonl'), 'utf8');
  assert.match(log, /"result":"unverified"/);
});

test('yotta-guardian before_tool pilot records native-audit correction', () => {
  const home = tmpDir('ys-hook-guardian-');
  const manifest = path.join(ROOT, '..', 'yotta-guardian', 'skill-manifest.json');
  const r = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'before_tool',
    '--manifest', manifest,
    '--context', JSON.stringify({
      checks: {
        guard_check: {
          ok: false,
          evidence: { audit_log: 'guardian-audit.jsonl' },
        },
      },
    }),
    '--json',
  ], home);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.decision, 'unverified');
  assert.strictEqual(payload.verified, false);
  assert.strictEqual(payload.correction, true);
  assert.strictEqual(payload.results[0].capability, 'native-audit');
  assert.match(payload.user_message, /explicit-unverified/);
  const log = fs.readFileSync(path.join(home, '.yottaskills', 'hook-log.jsonl'), 'utf8');
  assert.match(log, /"result":"unverified"/);
});

test('yotta-workflow start and milestone pilots preserve file evidence', () => {
  const home = tmpDir('ys-hook-workflow-');
  const manifest = path.join(ROOT, '..', 'yotta-workflow', 'skill-manifest.json');
  const start = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'before_start',
    '--manifest', manifest,
    '--context', JSON.stringify({
      checks: { read_state: { ok: true, evidence: { file_path: '.workflow/STATE.md' } } },
    }),
    '--json',
  ], home);
  assert.strictEqual(start.status, 0, start.stdout + start.stderr);
  const startPayload = JSON.parse(start.stdout);
  assert.strictEqual(startPayload.decision, 'allow');
  assert.strictEqual(startPayload.verified, true);

  const milestone = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'after_milestone',
    '--manifest', manifest,
    '--context', JSON.stringify({
      checks: { write_state: { ok: false, evidence: { file_path: '.workflow/STATE.md' } } },
    }),
    '--json',
  ], home);
  assert.strictEqual(milestone.status, 0, milestone.stdout + milestone.stderr);
  const milestonePayload = JSON.parse(milestone.stdout);
  assert.strictEqual(milestonePayload.decision, 'unverified');
  assert.strictEqual(milestonePayload.correction, true);
  assert.strictEqual(milestonePayload.results[0].capability, 'native-audit');
});

test('yotta-publish-guard wrapper blocks failed publish gate', () => {
  const home = tmpDir('ys-hook-publish-');
  const manifest = path.join(ROOT, '..', 'yotta-publish-guard', 'skill-manifest.json');
  const r = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'before_publish',
    '--manifest', manifest,
    '--context', JSON.stringify({
      wrapperRegistered: true,
      checks: {
        publish_gate: {
          ok: false,
          evidence: { exit_code: 2, audit_log: 'publish-audit.jsonl' },
        },
      },
    }),
    '--json',
  ], home);
  assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.decision, 'block');
  assert.strictEqual(payload.results[0].capability, 'wrapper-only');
});

test('yotta-publish-guard without wrapper is explicit-unverified', () => {
  const home = tmpDir('ys-hook-publish-');
  const manifest = path.join(ROOT, '..', 'yotta-publish-guard', 'skill-manifest.json');
  const r = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'before_publish',
    '--manifest', manifest,
    '--context', JSON.stringify({
      wrapperRegistered: false,
      checks: {
        publish_gate: {
          ok: false,
          evidence: { exit_code: 2, audit_log: 'publish-audit.jsonl' },
        },
      },
    }),
    '--json',
  ], home);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.decision, 'unverified');
  assert.strictEqual(payload.verified, false);
  assert.match(payload.user_message, /explicit-unverified/);
});

test('yotta-memory after_milestone pilot requires memory file evidence', () => {
  const home = tmpDir('ys-hook-memory-');
  const manifest = path.join(ROOT, '..', 'yotta-memory', 'skill-manifest.json');
  const ok = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'after_milestone',
    '--manifest', manifest,
    '--context', JSON.stringify({
      checks: {
        remember_commit: {
          ok: true,
          evidence: { file_path: '.yottamemory/private/codex/commits/2026-09-13-0208.md.enc' },
        },
      },
    }),
    '--json',
  ], home);
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  const okPayload = JSON.parse(ok.stdout);
  assert.strictEqual(okPayload.decision, 'allow');
  assert.strictEqual(okPayload.verified, true);

  const failed = run([
    'hook', 'evaluate',
    '--host', 'codex',
    '--event', 'after_milestone',
    '--manifest', manifest,
    '--context', JSON.stringify({
      checks: { remember_commit: { ok: false } },
    }),
    '--json',
  ], home);
  assert.strictEqual(failed.status, 0, failed.stdout + failed.stderr);
  const failedPayload = JSON.parse(failed.stdout);
  assert.strictEqual(failedPayload.decision, 'unverified');
  assert.strictEqual(failedPayload.correction, true);
  assert.strictEqual(failedPayload.results[0].capability, 'native-audit');
});
