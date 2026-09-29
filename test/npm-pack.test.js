'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const packLib = require('../lib/npm-pack');

const skill = { slug: 'yotta-chain', name: '元链', pkg: '@yottameta/yotta-chain', version: '0.1.4' };

const OK = { status: 0, stdout: 'yottameta-yotta-chain-0.1.4.tgz\n', stderr: '' };
const NOT_FOUND = {
  status: 1,
  stdout: '',
  stderr: 'npm error code E404\nnpm error 404 Not Found - GET https://cdn.npmmirror.com/packages/...',
};

function runner(handler, options) {
  const calls = [];
  const run = packLib.createPackRunner({
    spawnSync(command, args, opts) {
      calls.push([command, args, opts]);
      return handler(args, calls.length);
    },
    specOf: () => '@yottameta/yotta-chain@0.1.4',
    resolveNpm: () => ({ bin: 'npm', prefix: [], shell: true }),
    readdirSync: () => [],
    ...(options || {}),
  });
  return { run, calls };
}

test('returns tarball without retry when the first pack succeeds', () => {
  const { run, calls } = runner(() => OK);
  const result = run(skill, {}, 'D:/tmp/pack');
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.resolved, '0.1.4');
  assert.strictEqual(result.registryFallback, false);
  assert.strictEqual(calls.length, 1);
  assert.ok(!calls[0][1].includes('--registry'));
});

test('retries with the official registry when the default source returns 404', () => {
  const { run, calls } = runner((args, attempt) => (attempt === 1 ? NOT_FOUND : OK));
  const result = run(skill, {}, 'D:/tmp/pack');
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.resolved, '0.1.4');
  assert.strictEqual(result.registryFallback, true);
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[1][1].includes('--registry'));
  assert.ok(calls[1][1].includes(packLib.OFFICIAL_REGISTRY));
});

test('both attempts failing returns an error with the fix hint', () => {
  const { run, calls } = runner(() => NOT_FOUND);
  const result = run(skill, {}, 'D:/tmp/pack');
  assert.ok(result.error.includes(packLib.FALLBACK_HINT), result.error);
  assert.strictEqual(calls.length, 2);
});

test('non-404 failures are not retried and carry no fallback hint', () => {
  const { run, calls } = runner(() => ({ status: 1, stdout: '', stderr: 'npm error code ETIMEDOUT' }));
  const result = run(skill, {}, 'D:/tmp/pack');
  assert.strictEqual(calls.length, 1);
  assert.ok(!result.error.includes('镜像同步延迟'), result.error);
});

test('skips fallback when a registry flag is already present', () => {
  const previous = process.env.YOTTA_SKILLS_NPM_FLAGS;
  process.env.YOTTA_SKILLS_NPM_FLAGS = '--registry=https://registry.npmmirror.com/';
  try {
    const { run, calls } = runner(() => NOT_FOUND);
    run(skill, {}, 'D:/tmp/pack');
    assert.strictEqual(calls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.YOTTA_SKILLS_NPM_FLAGS;
    else process.env.YOTTA_SKILLS_NPM_FLAGS = previous;
  }
});

test('skips fallback when disabled', () => {
  const { run, calls } = runner(() => NOT_FOUND, { fallbackDisabled: () => true });
  run(skill, {}, 'D:/tmp/pack');
  assert.strictEqual(calls.length, 1);
});

test('reports a missing tarball when pack output has no tgz', () => {
  const { run } = runner(() => ({ status: 0, stdout: '', stderr: '' }));
  const result = run(skill, {}, 'D:/tmp/pack');
  assert.ok(result.error.includes('未找到 npm pack 产物'), result.error);
});
