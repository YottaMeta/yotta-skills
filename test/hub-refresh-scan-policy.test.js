'use strict';
/**
 * 0.29.2：hub refresh / adopt 复用安装管线 scanPolicy 复核（version + treeHash 绑定）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hubScanLib = require('../lib/hub-scan');
const policyLib = require('../lib/scan-policy');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'payload.js'), 'module.exports = 1;\n', 'utf8');
}

function fakeScan() {
  return {
    ok: true,
    verdict: 'DO NOT INSTALL',
    counts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    findings: [
      { rule_id: 'R-001', file: 'payload.js', severity: 'high' },
    ],
  };
}

test('reviewScanWithPolicy applies a version + treeHash bound exception', () => {
  const home = tmp('ys-scan-policy-ok-');
  try {
    const slug = 'yotta-memory';
    const version = '9.9.9';
    const skillDir = path.join(home, slug);
    writeSkill(skillDir, slug, version);
    const treeHash = policyLib.computeTreeHash(skillDir, slug);
    const policyPath = path.join(home, 'policy.json');
    fs.writeFileSync(policyPath, JSON.stringify({
      skills: {
        [slug]: {
          version,
          treeHash,
          exceptions: [{ action: 'allow', scanners: ['yotta-verify'], rule: 'R-001', path: 'payload.js', reason: 'reviewed' }],
        },
      },
    }), 'utf8');

    const reviewed = hubScanLib.reviewScanWithPolicy(fakeScan(), {
      slug, version, pkgDir: skillDir, policyPath,
    });
    assert.strictEqual(reviewed.policy.applied, true, JSON.stringify(reviewed.policy));
    assert.strictEqual(reviewed.policy.excluded, 1);
    assert.strictEqual(reviewed.verdict, 'SAFE TO INSTALL');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('reviewScanWithPolicy stays fail-closed on version / treeHash mismatch', () => {
  const home = tmp('ys-scan-policy-miss-');
  try {
    const slug = 'yotta-memory';
    const version = '9.9.9';
    const skillDir = path.join(home, slug);
    writeSkill(skillDir, slug, version);
    const treeHash = policyLib.computeTreeHash(skillDir, slug);
    const policyPath = path.join(home, 'policy.json');
    fs.writeFileSync(policyPath, JSON.stringify({
      skills: {
        [slug]: {
          version,
          treeHash,
          exceptions: [{ action: 'allow', scanners: ['yotta-verify'], rule: 'R-001', path: 'payload.js' }],
        },
      },
    }), 'utf8');

    const wrongVersion = hubScanLib.reviewScanWithPolicy(fakeScan(), {
      slug, version: '0.0.1', pkgDir: skillDir, policyPath,
    });
    assert.strictEqual(wrongVersion.policy.applied, false);
    assert.strictEqual(wrongVersion.policy.reason, 'version-mismatch');
    assert.strictEqual(wrongVersion.verdict, 'DO NOT INSTALL');

    fs.writeFileSync(path.join(skillDir, 'payload.js'), 'module.exports = 2;\n', 'utf8');
    const tampered = hubScanLib.reviewScanWithPolicy(fakeScan(), {
      slug, version, pkgDir: skillDir, policyPath,
    });
    assert.strictEqual(tampered.policy.applied, false);
    assert.strictEqual(tampered.policy.reason, 'treehash-mismatch');
    assert.strictEqual(tampered.verdict, 'DO NOT INSTALL');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
