'use strict';
/**
 * 0.28.0 宿主目录核实批次：映射解析（XDG 显式集）+ verified / bridgeOnly 分类。
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

const dirs = require('../lib/agent-dirs');

const HOME = path.join(os.tmpdir(), 'ys-scope-home');
const XDG = path.join(os.tmpdir(), 'ys-scope-xdg');
const STATE = path.join(os.tmpdir(), 'ys-scope-state');
const DATA = path.join(os.tmpdir(), 'ys-scope-data');
const ENV = { XDG_CONFIG_HOME: XDG, XDG_STATE_HOME: STATE, XDG_DATA_HOME: DATA };

test('XDG_CONFIG_HOME applies only to the verified XDG hosts', () => {
  const opts = { homeDir: HOME, env: ENV };
  assert.strictEqual(dirs.resolveUserDir('.config/agents/skills', opts), path.join(XDG, 'agents', 'skills'));
  assert.strictEqual(dirs.resolveUserDir('.config/devin/skills', opts), path.join(XDG, 'devin', 'skills'));
  assert.strictEqual(dirs.resolveUserDir('.config/opencode/skills', opts), path.join(XDG, 'opencode', 'skills'));
  // literal ~/.config hosts must not follow XDG (upstream table + machine evidence)
  assert.strictEqual(dirs.resolveUserDir('.config/goose/skills', opts), path.join(HOME, '.config', 'goose', 'skills'));
  assert.strictEqual(dirs.resolveUserDir('.config/crush/skills', opts), path.join(HOME, '.config', 'crush', 'skills'));
  assert.strictEqual(dirs.resolveUserDir('.config/kimchi/harness/skills', opts), path.join(HOME, '.config', 'kimchi', 'harness', 'skills'));
  assert.strictEqual(dirs.resolveUserDir('.config/mimocode/skills', opts), path.join(HOME, '.config', 'mimocode', 'skills'));
});

test('without XDG_CONFIG_HOME the config paths stay under the home config dir', () => {
  const opts = { homeDir: HOME, env: {} };
  assert.strictEqual(dirs.resolveUserDir('.config/agents/skills', opts), path.join(HOME, '.config', 'agents', 'skills'));
  assert.strictEqual(dirs.resolveUserDir('.config/opencode/skills', opts), path.join(HOME, '.config', 'opencode', 'skills'));
  assert.strictEqual(dirs.resolveUserDir('.config/goose/skills', opts), path.join(HOME, '.config', 'goose', 'skills'));
});

test('0.28.0 mapping fixes: replit / universal / mimocode / goose', () => {
  assert.deepStrictEqual(dirs.AGENT_DIRS.replit.dirs, ['.config/agents/skills']);
  assert.deepStrictEqual(dirs.AGENT_DIRS.universal.dirs, ['.config/agents/skills', '.agents/skills']);
  assert.deepStrictEqual(dirs.AGENT_DIRS.mimocode.dirs, ['.config/mimocode/skills']);
  assert.deepStrictEqual(dirs.AGENT_DIRS.goose.dirs, ['.config/goose/skills', '.agents/skills']);
  assert.ok(dirs.XDG_CONFIG_RELS.has('.config/agents/skills'));
  assert.ok(!dirs.XDG_CONFIG_RELS.has('.config/goose/skills'));
});

test('known roots carry the verified flag (unverified hosts are not default-linked)', () => {
  const opts = { homeDir: HOME, env: ENV };
  const roots = dirs.knownRoots(opts);
  const byDir = new Map(roots.map((root) => [root.dir, root]));
  assert.strictEqual(byDir.get(path.join(XDG, 'agents', 'skills')).verified, true);
  assert.strictEqual(byDir.get(path.join(HOME, '.config', 'mimocode', 'skills')).verified, true);
  // 0.29.1 U2：YottaCode 不纳入元阁接管（映射 / env / 扫描 / 注册全部排除）。
  assert.strictEqual(byDir.get(path.join(HOME, '.yottacode', 'skills')), undefined);
  assert.strictEqual(byDir.get(path.join(HOME, '.box-agent', 'skills')).verified, false);
});

test('env roots: state / data bridges are flagged and never treated as hosts', () => {
  const roots = dirs.envRoots({ homeDir: HOME, env: ENV });
  const state = roots.find((root) => root.dir === path.join(STATE, 'skills'));
  const data = roots.find((root) => root.dir === path.join(DATA, 'skills'));
  assert.ok(state && state.bridgeOnly === true);
  assert.ok(data && data.bridgeOnly === true);
  assert.strictEqual(dirs.isBridgeOnlyDir(path.join(STATE, 'skills'), { env: ENV }), true);
  assert.strictEqual(dirs.isBridgeOnlyDir(path.join(STATE, 'skills', 'yotta-x'), { env: ENV }), true);
  assert.strictEqual(dirs.isBridgeOnlyDir(path.join(DATA, 'skills'), { env: ENV }), true);
  assert.strictEqual(dirs.isBridgeOnlyDir(path.join(HOME, '.claude', 'skills'), { env: ENV }), false);
});
