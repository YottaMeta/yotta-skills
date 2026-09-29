'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const policyLib = require('../lib/scan-policy');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root, rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function buildPkg(prefix, files) {
  const dir = tmpDir(prefix);
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  return dir;
}

test('computeTreeHash ignores pruned top-level artifacts', () => {
  const base = buildPkg('ys-policy-a-', { 'SKILL.md': '# a\n' });
  const withJunk = buildPkg('ys-policy-b-', {
    'SKILL.md': '# a\n',
    'package.json': '{"name":"x"}',
    'install.sh': '#!/bin/sh\n',
    'test/x.test.js': 'x\n',
    '.github/workflows/w.yml': 'x\n',
  });
  assert.strictEqual(
    policyLib.computeTreeHash(withJunk, 'yotta-demo'),
    policyLib.computeTreeHash(base, 'yotta-demo'),
  );
});

test('computeTreeHash keeps bin only for slugs listed in KEEP_EXTRA', () => {
  const base = buildPkg('ys-policy-c-', { 'SKILL.md': '# a\n' });
  const withBin = buildPkg('ys-policy-d-', { 'SKILL.md': '# a\n', 'bin/cli.js': 'x\n' });
  assert.notStrictEqual(
    policyLib.computeTreeHash(withBin, 'yotta-memory'),
    policyLib.computeTreeHash(base, 'yotta-memory'),
  );
  assert.strictEqual(
    policyLib.computeTreeHash(withBin, 'yotta-anti-shallow'),
    policyLib.computeTreeHash(base, 'yotta-anti-shallow'),
  );
});

test('computeTreeHash ignores caches and notices content changes', () => {
  const clean = buildPkg('ys-policy-e-', { 'SKILL.md': '# a\n' });
  const cached = buildPkg('ys-policy-f-', {
    'SKILL.md': '# a\n',
    '__pycache__/x.pyc': 'x',
    'scripts/__pycache__/y.pyc': 'y',
    'scripts/old.pyo': 'z',
  });
  assert.strictEqual(
    policyLib.computeTreeHash(cached, 'yotta-demo'),
    policyLib.computeTreeHash(clean, 'yotta-demo'),
  );
  const changed = buildPkg('ys-policy-g-', { 'SKILL.md': '# b\n' });
  assert.notStrictEqual(
    policyLib.computeTreeHash(changed, 'yotta-demo'),
    policyLib.computeTreeHash(clean, 'yotta-demo'),
  );
});

test('summarize maps the highest severity to the verifier verdict', () => {
  assert.strictEqual(policyLib.summarize([]).verdict, 'SAFE TO INSTALL');
  assert.strictEqual(policyLib.summarize([{ severity: 'low' }]).verdict, 'SAFE TO INSTALL');
  assert.strictEqual(policyLib.summarize([{ severity: 'medium' }]).verdict, 'REVIEW REQUIRED');
  assert.strictEqual(policyLib.summarize([{ severity: 'high' }]).verdict, 'INSTALL WITH CAUTION');
  assert.strictEqual(policyLib.summarize([{ severity: 'critical' }]).verdict, 'DO NOT INSTALL');
});

function scenario(overrides) {
  const pkgDir = buildPkg('ys-policy-s-', { 'SKILL.md': '# a\n', 'scripts/tool.js': 'x\n' });
  const treeHash = policyLib.computeTreeHash(pkgDir, 'yotta-demo');
  const policy = {
    skills: {
      'yotta-demo': {
        version: '1.0.0',
        treeHash,
        exceptions: [
          {
            scanners: ['yotta-verify', 'yotta-agent-hardening'],
            rule: 'DEX-007',
            path: 'scripts/tool.js',
            action: 'allow',
            detection: true,
            reason: 'detection-rule',
          },
        ],
      },
    },
  };
  const scan = {
    ok: true,
    verdict: 'DO NOT INSTALL',
    counts: { critical: 1, high: 0, medium: 0, low: 2, info: 0 },
    findings: [
      { severity: 'critical', rule_id: 'DEX-007', file: 'scripts/tool.js' },
      { severity: 'low', rule_id: 'NET-001', file: 'scripts/tool.js' },
      { severity: 'low', rule_id: 'NET-002', file: 'SKILL.md' },
    ],
  };
  return { pkgDir, policy, scan, context: { slug: 'yotta-demo', version: '1.0.0', pkgDir, policy: overrides ? overrides.policy || policy : policy } };
}

test('applyScanPolicy excludes reviewed findings and recomputes the verdict', () => {
  const { scan, context } = scenario();
  const result = policyLib.applyScanPolicy(scan, context);
  assert.strictEqual(result.policy.applied, true);
  assert.strictEqual(result.policy.excluded, 1);
  assert.strictEqual(result.verdict, 'SAFE TO INSTALL');
  assert.deepStrictEqual(result.counts, { critical: 0, high: 0, medium: 0, low: 2, info: 0 });
  assert.strictEqual(result.findings.length, 2);
});

test('applyScanPolicy is fail-closed on version or treeHash mismatch', () => {
  const { scan, context } = scenario();
  const wrongVersion = policyLib.applyScanPolicy(scan, { ...context, version: '2.0.0' });
  assert.strictEqual(wrongVersion.policy.applied, false);
  assert.strictEqual(wrongVersion.policy.reason, 'version-mismatch');
  assert.strictEqual(wrongVersion.verdict, 'DO NOT INSTALL');

  const { scan: scan2, context: context2, pkgDir } = scenario();
  write(pkgDir, 'scripts/tool.js', 'tampered\n');
  const tampered = policyLib.applyScanPolicy(scan2, context2);
  assert.strictEqual(tampered.policy.applied, false);
  assert.strictEqual(tampered.policy.reason, 'treehash-mismatch');
  assert.strictEqual(tampered.verdict, 'DO NOT INSTALL');
});

test('applyScanPolicy does not exempt on path, rule, action or scanner mismatch', () => {
  const cases = [
    { file: 'scripts/other.js' },
    { rule_id: 'PIJ-001' },
  ];
  for (const patch of cases) {
    const { scan, context } = scenario();
    scan.findings = [{ severity: 'critical', rule_id: 'DEX-007', file: 'scripts/tool.js', ...patch }];
    const result = policyLib.applyScanPolicy(scan, context);
    assert.strictEqual(result.policy.excluded, 0);
    assert.strictEqual(result.verdict, 'DO NOT INSTALL');
  }
  const warn = scenario();
  warn.policy.skills['yotta-demo'].exceptions[0].action = 'warn';
  warn.context.policy = warn.policy;
  assert.strictEqual(policyLib.applyScanPolicy(warn.scan, warn.context).verdict, 'DO NOT INSTALL');

  const otherScanner = scenario();
  otherScanner.policy.skills['yotta-demo'].exceptions[0].scanners = ['yotta-agent-hardening'];
  otherScanner.context.policy = otherScanner.policy;
  assert.strictEqual(policyLib.applyScanPolicy(otherScanner.scan, otherScanner.context).verdict, 'DO NOT INSTALL');
});

test('applyScanPolicy requires findings and an entry for the slug', () => {
  const { scan, context } = scenario();
  const noFindings = { ...scan, findings: undefined };
  assert.strictEqual(policyLib.applyScanPolicy(noFindings, context).policy.reason, 'findings-unavailable');
  const unknown = policyLib.applyScanPolicy(scan, { ...context, slug: 'yotta-unknown' });
  assert.strictEqual(unknown.policy.reason, 'no-entry');
  assert.strictEqual(unknown.verdict, 'DO NOT INSTALL');
});

test('shipped scan-policy matches handoff lock bindings', (t) => {
  const policyPath = path.join(REPO_ROOT, 'yottaskills', 'yotta-skills', 'scan-policy.json');
  const lockPath = path.join(REPO_ROOT, 'handoff', 'opencode-v1', 'skills.lock.json');
  if (!fs.existsSync(policyPath) || !fs.existsSync(lockPath)) {
    t.skip('仓库缺少 scan-policy.json 或 handoff lock');
    return;
  }
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const lockBySlug = new Map(lock.skills.map((item) => [item.slug, item]));
  let checked = 0;
  for (const [slug, entry] of Object.entries(policy.skills)) {
    const locked = lockBySlug.get(slug);
    assert.ok(locked, `${slug} 不在 handoff lock 中`);
    assert.strictEqual(entry.treeHash, locked.treeHash, `${slug} treeHash 与 handoff lock 不一致`);
    assert.strictEqual(entry.version, locked.version, `${slug} 版本与 handoff lock 不一致`);
    checked += 1;
  }
  assert.ok(checked >= 9, '扫码例外表覆盖技能数异常');
});

test('scan-policy covers the family install blockers (memory / logwatch / triage)', () => {
  const policyPath = path.join(REPO_ROOT, 'yottaskills', 'yotta-skills', 'scan-policy.json');
  if (!fs.existsSync(policyPath)) {
    assert.fail('缺少 scan-policy.json');
  }
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  for (const slug of ['yotta-memory', 'yotta-logwatch', 'yotta-triage']) {
    assert.ok(policy.skills[slug], `${slug} 缺少例外条目`);
    assert.ok(policy.skills[slug].exceptions.length > 0, `${slug} 例外为空`);
  }
});
