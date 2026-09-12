'use strict';
const fs = require('fs');
const path = require('path');

const SAFE = 'SAFE TO INSTALL';
const CAUTION = 'INSTALL WITH CAUTION';
const REVIEW = 'REVIEW REQUIRED';
const BLOCK = 'DO NOT INSTALL';

function candidateVerifierPaths(dest, opts) {
  const candidates = [];
  if (opts && opts.verify) candidates.push(path.resolve(opts.verify));
  if (process.env.YOTTA_SKILLS_VERIFY) candidates.push(path.resolve(process.env.YOTTA_SKILLS_VERIFY));
  if (dest) candidates.push(path.join(dest, 'yotta-verify', 'scripts', 'yotta_verify.py'));
  return candidates;
}

function findVerifier(context) {
  const registry = context.registry;
  const candidates = candidateVerifierPaths(context.dest, context.opts);
  if (registry && registry.skills && registry.skills['yotta-verify']) {
    for (const dir of registry.skills['yotta-verify'].source_dirs || []) {
      candidates.push(path.join(dir, 'scripts', 'yotta_verify.py'));
    }
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) {
      // Try the next candidate.
    }
  }
  return null;
}

function parseScanOutput(stdout) {
  try {
    const value = JSON.parse(String(stdout || ''));
    if (!value || typeof value.verdict !== 'string') {
      return { ok: false, verdict: null, counts: null, error: '扫描输出缺少 verdict' };
    }
    return { ok: true, verdict: value.verdict, counts: value.counts || {}, error: null };
  } catch (error) {
    return { ok: false, verdict: null, counts: null, error: error.message };
  }
}

function evaluateVerdict(verdict) {
  if (verdict === SAFE) return { decision: 'allow', block: false, warn: false };
  if (verdict === CAUTION || verdict === REVIEW) return { decision: 'warn', block: false, warn: true };
  return { decision: 'block', block: true, warn: true };
}

function runVerifier(engine, target, options) {
  const result = options.spawnSync(options.python, ['-B', engine, 'scan', target, '--json'], {
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result && result.error) {
    return { ok: false, verdict: null, counts: null, error: result.error.message, exitCode: null };
  }
  if (!result || result.status === null) {
    return { ok: false, verdict: null, counts: null, error: '元信 scan 执行失败', exitCode: null };
  }
  const parsed = parseScanOutput(result.stdout);
  if (!parsed.ok) {
    return { ok: false, verdict: null, counts: null, error: parsed.error, exitCode: result.status };
  }
  return { ok: true, verdict: parsed.verdict, counts: parsed.counts, error: null, exitCode: result.status };
}

module.exports = {
  SAFE,
  CAUTION,
  REVIEW,
  BLOCK,
  findVerifier,
  parseScanOutput,
  evaluateVerdict,
  runVerifier,
};
