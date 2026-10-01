'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { COPY_SKIP, shouldSkipCache, copyDir } = require('../lib/copy-tree.js');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-copy-tree-'));
  const src = path.join(root, 'src');
  const dst = path.join(root, 'dst');
  const write = (rel, content) => {
    const file = path.join(src, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  };
  // 顶层开发件：应跳过
  write('package.json', '{"name":"fixture"}');
  write('bin/cli.js', '// top-level bin');
  write('node_modules/dep/index.js', '// top-level node_modules');
  write('.git/HEAD', 'ref: refs/heads/main');
  // 正常载荷：应保留
  write('SKILL.md', '# fixture');
  write('scripts/yotta_fixture.py', 'print("ok")');
  // 嵌套同名载荷：必须保留（元造 template/ 场景）
  write('template/package.json', '{"name":"{{skill_name}}"}');
  write('template/bin/install.js', '// nested installer');
  write('template/.github/workflows/publish.yml', 'name: publish');
  // 缓存 / 编译产物：任意层级都跳过
  write('scripts/__pycache__/yotta_fixture.cpython-311.pyc', 'cache');
  write('scripts/stale.pyc', 'cache');
  write('.pytest_cache/CACHEDIR.TAG', 'cache');
  return { root, src, dst };
}

test('copyDir 顶层同名跳过、嵌套同名保留、缓存全层清理', () => {
  const { root, src, dst } = makeFixture();
  try {
    fs.mkdirSync(dst, { recursive: true });
    copyDir(src, dst, COPY_SKIP, true);

    const exists = (rel) => fs.existsSync(path.join(dst, rel));
    // 顶层开发件跳过
    assert.equal(exists('package.json'), false);
    assert.equal(exists('bin'), false);
    assert.equal(exists('node_modules'), false);
    assert.equal(exists('.git'), false);
    // 载荷保留
    assert.equal(exists('SKILL.md'), true);
    assert.equal(exists('scripts/yotta_fixture.py'), true);
    // 嵌套同名载荷保留（本批修复回归点）
    assert.equal(exists('template/package.json'), true);
    assert.equal(exists('template/bin/install.js'), true);
    assert.equal(exists('template/.github/workflows/publish.yml'), true);
    // 缓存 / 编译产物全层清理
    assert.equal(exists('scripts/__pycache__'), false);
    assert.equal(exists('scripts/stale.pyc'), false);
    assert.equal(exists('.pytest_cache'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copyDir 嵌套载荷逐字节一致（不改写内容）', () => {
  const { root, src, dst } = makeFixture();
  try {
    fs.mkdirSync(dst, { recursive: true });
    copyDir(src, dst, COPY_SKIP, true);
    const readSrc = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');
    const readDst = (rel) => fs.readFileSync(path.join(dst, rel), 'utf8');
    for (const rel of ['template/package.json', 'template/bin/install.js', 'SKILL.md']) {
      assert.equal(readDst(rel), readSrc(rel), rel);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shouldSkipCache 覆盖缓存目录与编译产物，不误伤载荷名', () => {
  assert.equal(shouldSkipCache('__pycache__', false), true);
  assert.equal(shouldSkipCache('.pytest_cache', false), true);
  assert.equal(shouldSkipCache('.mypy_cache', false), true);
  assert.equal(shouldSkipCache('x.pyc', true), true);
  assert.equal(shouldSkipCache('x.pyo', true), true);
  assert.equal(shouldSkipCache('package.json', true), false);
  assert.equal(shouldSkipCache('bin', false), false);
  assert.equal(shouldSkipCache('install.js', true), false);
});
