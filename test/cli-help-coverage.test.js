'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const help = require('../lib/cli-help');

const EXPECTED_PATHS = [
  'install',
  'install-self',
  'update',
  '--dry-run',
  'where',
  'doctor',
  'rollback',
  '--list',
  '--inventory',
  '--reindex',
  '--route',
  'decide-memory',
  'hub',
  'hub hosts',
  'hub hosts add',
  'hub hosts remove',
  'hub hosts list',
  'hub hosts mark',
  'hub hosts exclude',
  'hub hosts include',
  'hub hosts set',
  'hub config get',
  'hub config set',
  'hub config rollback',
  'hub config clear',
  'hub cleanup-backups',
  'hub install',
  'hub update',
  'hub adopt',
  'hub refresh',
  'hub link',
  'hub unlink',
  'hub remove',
  'hub status',
  'hub doctor',
  'usage',
  'usage status',
  'usage enable',
  'usage disable',
  'usage mark',
  'usage reset',
  'hook',
  'hook capabilities',
  'hook evaluate',
  'hook bind',
  'hook unbind',
  'view',
  '--version',
  '--help',
];

function commandPaths() {
  const paths = [];
  for (const group of help.CLI_HELP_MODEL) {
    for (const cmd of group.commands) {
      paths.push(cmd.name);
      for (const sub of cmd.subcommands || []) paths.push(cmd.name + ' ' + sub.name);
    }
  }
  return paths;
}

test('cli help model covers the canonical command surface', () => {
  assert.deepStrictEqual(commandPaths().sort(), EXPECTED_PATHS.slice().sort());
});

test('cli help model entries are complete and reference real global options', () => {
  const flags = new Set(help.CLI_GLOBAL_OPTIONS.map((opt) => opt.flag));
  for (const group of help.CLI_HELP_MODEL) {
    assert.ok(group.group && group.commands.length > 0, 'group needs a name and commands');
    for (const cmd of group.commands) {
      assert.ok(cmd.usage.startsWith(cmd.name), 'usage must start with the command name: ' + cmd.name);
      assert.ok(cmd.what && cmd.when, 'command needs what/when: ' + cmd.name);
      for (const opt of cmd.options || []) assert.ok(flags.has(opt), 'unknown option ref: ' + opt);
      for (const sub of cmd.subcommands || []) {
        assert.ok(sub.usage.startsWith(cmd.name + ' ' + sub.name), 'subcommand usage mismatch: ' + sub.name);
        assert.ok(sub.what && sub.when, 'subcommand needs what/when: ' + sub.name);
        for (const opt of sub.options || []) assert.ok(flags.has(opt), 'unknown subcommand option ref: ' + opt);
      }
    }
  }
  for (const opt of help.CLI_GLOBAL_OPTIONS) {
    assert.ok(opt.flag && opt.what, 'global option needs flag/what: ' + opt.flag);
  }
});

test('cli help quick list covers every command and subcommand with unique runnable examples', () => {
  const paths = new Set(commandPaths());
  const seen = new Set();
  const covered = new Set();
  for (const group of help.CLI_HELP_QUICK) {
    assert.ok(group.group && group.items.length > 0, 'quick group needs items');
    for (const item of group.items) {
      assert.ok(paths.has(item.cmd), 'quick item must reference a real command/subcommand: ' + item.cmd);
      assert.match(item.example, /^yotta-skills /, 'example must be runnable: ' + item.example);
      assert.ok(!seen.has(item.example), 'duplicate example: ' + item.example);
      seen.add(item.example);
      covered.add(item.cmd);
      if (item.danger) assert.ok(item.note && item.note.length > 0, 'danger item needs a note: ' + item.cmd);
    }
  }
  for (const commandPath of paths) {
    assert.ok(covered.has(commandPath), 'quick list is missing: ' + commandPath);
  }
});

test('--help renders from the same model (parity both ways)', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  for (const group of help.CLI_HELP_MODEL) {
    for (const cmd of group.commands) {
      assert.ok(r.stdout.includes('yotta-skills ' + cmd.usage), 'help missing: ' + cmd.usage);
      for (const sub of cmd.subcommands || []) {
        assert.ok(r.stdout.includes('yotta-skills ' + sub.usage), 'help missing: ' + sub.usage);
      }
    }
  }
  for (const opt of help.CLI_GLOBAL_OPTIONS) {
    const flag = opt.flag + (opt.arg ? ' ' + opt.arg : '');
    assert.ok(r.stdout.includes(flag), 'help missing option: ' + flag);
  }
});
