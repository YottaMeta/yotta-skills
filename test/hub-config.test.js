'use strict';
/**
 * 0.29.2 U4：Hub 位置持久化（config.json）—— 解析优先级 / 校验 / CLI set·get·clear / --move。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const configLib = require('../lib/skills-config');
const hub = require('../lib/hub');

const BIN = path.join(__dirname, '..', 'bin', 'yotta-skills.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir, slug, version) {
  const target = path.join(dir, slug);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'),
    '---\nname: ' + slug + '\nversion: ' + version + '\ndescription: test skill\n---\n# ' + slug + '\n', 'utf8');
  return target;
}

function makeEnv(home) {
  return {
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
    XDG_DATA_HOME: path.join(home, '.data'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    YOTTA_SKILLS_DISCOVERY_NO_CWD: '1',
  };
}

function runCli(home, args) {
  const env = {
    ...process.env,
    ...makeEnv(home),
    YOTTA_SKILLS_HOME: path.join(home, '.yottaskills'),
  };
  delete env.YOTTA_SKILLS_HUB;
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 120000 });
}

function linkDir(target, linkPath) {
  fs.symlinkSync(path.resolve(target), linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

test('resolveHub priority: flag > env > config > default', () => {
  const home = tmp('ys-cfg-prio-');
  try {
    const configHub = path.join(home, 'from-config');
    configLib.setHub({ homeDir: home, env: {} }, { hub: configHub });
    const fromConfig = hub.resolveHub({ homeDir: home, env: {} });
    assert.strictEqual(fromConfig.source, 'config');
    assert.strictEqual(path.resolve(fromConfig.dir), path.resolve(configHub));

    const envHub = path.join(home, 'from-env');
    const fromEnv = hub.resolveHub({ homeDir: home, env: { YOTTA_SKILLS_HUB: envHub } });
    assert.strictEqual(fromEnv.source, 'env');
    assert.strictEqual(path.resolve(fromEnv.dir), path.resolve(envHub));

    const flagHub = path.join(home, 'from-flag');
    const fromFlag = hub.resolveHub({ homeDir: home, env: { YOTTA_SKILLS_HUB: envHub }, hub: flagHub });
    assert.strictEqual(fromFlag.source, 'flag');
    assert.strictEqual(path.resolve(fromFlag.dir), path.resolve(flagHub));

    const other = tmp('ys-cfg-default-');
    try {
      const fallback = hub.resolveHub({ homeDir: other, env: {} });
      assert.strictEqual(fallback.source, 'default');
      assert.strictEqual(path.resolve(fallback.dir), path.join(other, '.yottaskills', 'hub'));
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('setHub / clearHub roundtrip writes atomic config.json', () => {
  const home = tmp('ys-cfg-round-');
  try {
    const target = path.join(home, 'my-hub');
    const set = configLib.setHub({ homeDir: home, env: {} }, { hub: target });
    assert.strictEqual(set.ok, true, set.error);
    const raw = JSON.parse(fs.readFileSync(path.join(home, '.yottaskills', 'config.json'), 'utf8'));
    assert.strictEqual(raw.version, 1);
    assert.strictEqual(path.resolve(raw.hub), path.resolve(target));
    assert.strictEqual(configLib.readConfig({ homeDir: home, env: {} }).hub, path.resolve(target));

    const clear = configLib.clearHub({ homeDir: home, env: {} });
    assert.strictEqual(clear.ok, true, clear.error);
    assert.strictEqual(configLib.readConfig({ homeDir: home, env: {} }).hub, null);
    assert.strictEqual(configLib.clearHub({ homeDir: home, env: {} }).ok, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('validateHubPath is fail-closed on file / root / self-install / bridge paths', () => {
  const home = tmp('ys-cfg-guard-');
  try {
    const opts = { homeDir: home, env: { XDG_STATE_HOME: path.join(home, '.state') } };
    const file = path.join(home, 'plain.txt');
    fs.writeFileSync(file, 'x', 'utf8');
    assert.match(configLib.validateHubPath(file, opts).error, /不是目录/);

    const root = path.join(home, '.yottaskills');
    assert.match(configLib.validateHubPath(root, opts).error, /配置根/);
    assert.match(configLib.validateHubPath(home, opts).error, /配置根/);

    const selfDir = path.join(root, 'yotta-skills');
    assert.match(configLib.validateHubPath(selfDir, opts).error, /独立安装目录/);
    assert.match(configLib.validateHubPath(path.join(selfDir, 'inner'), opts).error, /独立安装目录/);

    const bridge = path.join(home, '.state', 'skills');
    assert.match(configLib.validateHubPath(bridge, opts).error, /桥接目录/);

    assert.strictEqual(configLib.validateHubPath(path.join(home, 'ok-hub'), opts).ok, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI: hub config set / get / clear + --hub misuse fail-closed', () => {
  const home = tmp('ys-cfg-cli-');
  try {
    const target = path.join(home, 'cli-hub');
    const set = runCli(home, ['hub', 'config', 'set', '--hub', target, '--json']);
    assert.strictEqual(set.status, 0, set.stderr);
    const setPayload = JSON.parse(set.stdout);
    assert.strictEqual(setPayload.action, 'config.set');
    assert.strictEqual(setPayload.source, 'config');
    assert.strictEqual(path.resolve(setPayload.hub), path.resolve(target));

    const get = runCli(home, ['hub', 'config', 'get', '--json']);
    assert.strictEqual(get.status, 0, get.stderr);
    const getPayload = JSON.parse(get.stdout);
    assert.strictEqual(getPayload.source, 'config');
    assert.strictEqual(path.resolve(getPayload.configured), path.resolve(target));

    const clear = runCli(home, ['hub', 'config', 'clear', '--json']);
    assert.strictEqual(clear.status, 0, clear.stderr);
    assert.strictEqual(JSON.parse(clear.stdout).action, 'config.clear');
    const afterClear = runCli(home, ['hub', 'config', 'get', '--json']);
    assert.strictEqual(afterClear.status, 0, afterClear.stderr);
    assert.strictEqual(JSON.parse(afterClear.stdout).source, 'default');

    const bare = runCli(home, ['--hub', target]);
    assert.strictEqual(bare.status, 2);
    assert.match(bare.stderr, /--hub 只能与 hub \/ view \/ where/);

    const install = runCli(home, ['install', '--hub', target, '--dry-run']);
    assert.strictEqual(install.status, 2);
    assert.match(install.stderr, /--hub 只能与 hub \/ view \/ where/);

    const moveOnly = runCli(home, ['hub', 'status', '--move']);
    assert.strictEqual(moveOnly.status, 2);
    assert.match(moveOnly.stderr, /--move 只能与 hub config set/);

    const setNoHub = runCli(home, ['hub', 'config', 'set']);
    assert.strictEqual(setNoHub.status, 2);
    assert.match(setNoHub.stderr, /需要 --hub/);

    const selfOverlap = runCli(home, ['hub', 'config', 'set', '--hub', path.join(home, '.yottaskills', 'yotta-skills')]);
    assert.strictEqual(selfOverlap.status, 2);
    assert.match(selfOverlap.stderr, /独立安装目录/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI: hub config set --move migrates hub, relinks hosts and trashes the old hub', () => {
  const home = tmp('ys-cfg-move-');
  try {
    const root = path.join(home, '.yottaskills');
    const oldHub = path.join(root, 'hub');
    const newHub = path.join(root, 'hub2');
    const oldSkill = writeSkill(oldHub, 'yotta-demo', '1.0.0');
    fs.writeFileSync(path.join(oldHub, 'root-marker.txt'), 'marker\n', 'utf8');
    const hostDir = path.join(home, '.agents', 'skills');
    fs.mkdirSync(hostDir, { recursive: true });
    const hostLink = path.join(hostDir, 'yotta-demo');
    linkDir(oldSkill, hostLink);

    const moved = runCli(home, ['hub', 'config', 'set', '--hub', newHub, '--move', '--json']);
    assert.strictEqual(moved.status, 0, moved.stderr);
    const payload = JSON.parse(moved.stdout);
    assert.strictEqual(payload.move.moved, true);
    assert.strictEqual(payload.move.incomplete, 0);

    assert.ok(fs.existsSync(path.join(newHub, 'yotta-demo', 'SKILL.md')), 'new hub must carry the skill');
    assert.ok(fs.existsSync(path.join(newHub, 'root-marker.txt')), 'new hub must carry root files');
    assert.strictEqual(
      fs.realpathSync.native(hostLink).toLowerCase(),
      fs.realpathSync.native(path.join(newHub, 'yotta-demo')).toLowerCase(),
      'host link must point at the new hub');
    assert.ok(!fs.existsSync(oldHub), 'old hub must be retired to trash');
    const trashRoot = path.join(root, 'trash');
    assert.ok(fs.existsSync(trashRoot), 'trash root expected');
    assert.ok(fs.readdirSync(trashRoot).some((name) => name.startsWith('hub-migrate-')), 'migration trash expected');

    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.strictEqual(path.resolve(cfg.hub), path.resolve(newHub));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI: hub config set (switch only) records lastSwitch and get shows the pending hint', () => {
  const home = tmp('ys-cfg-switch-');
  try {
    const root = path.join(home, '.yottaskills');
    const oldHub = path.join(root, 'hub');
    const newHub = path.join(home, 'switched-hub');
    writeSkill(oldHub, 'yotta-demo', '1.0.0');

    const set = runCli(home, ['hub', 'config', 'set', '--hub', newHub, '--json']);
    assert.strictEqual(set.status, 0, set.stderr);
    const setPayload = JSON.parse(set.stdout);
    assert.strictEqual(setPayload.move.moved, false);
    assert.strictEqual(setPayload.move.oldSkills, 1);

    const get = runCli(home, ['hub', 'config', 'get', '--json']);
    assert.strictEqual(get.status, 0, get.stderr);
    const getPayload = JSON.parse(get.stdout);
    assert.ok(getPayload.lastSwitch, 'lastSwitch must be recorded');
    assert.strictEqual(path.resolve(getPayload.lastSwitch.from), path.resolve(oldHub));
    assert.strictEqual(getPayload.lastSwitch.skills, 1);
    assert.strictEqual(getPayload.lastMigration, null);

    const text = runCli(home, ['hub', 'config', 'get']);
    assert.match(text.stdout, /未迁移提示/);
    assert.match(text.stdout, /还有 1 个技能未迁移/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI: doctor empty-hub hint points at the pending old hub migration', () => {
  const home = tmp('ys-cfg-doctor-');
  try {
    const oldHub = path.join(home, '.yottaskills', 'hub');
    writeSkill(oldHub, 'yotta-demo', '1.0.0');
    const newHub = path.join(home, 'empty-new-hub');
    fs.mkdirSync(newHub, { recursive: true });
    const set = runCli(home, ['hub', 'config', 'set', '--hub', newHub, '--json']);
    assert.strictEqual(set.status, 0, set.stderr);
    const doctor = runCli(home, ['hub', 'doctor', '--json']);
    const payload = JSON.parse(doctor.stdout);
    const check = (payload.checks || []).find((item) => item.id === 'hub_nonempty');
    assert.ok(check, JSON.stringify(payload.checks));
    assert.match(check.hint, /未迁移/);
    assert.match(check.hint, /--move/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI: hub config rollback previews then reverses the migration position', () => {
  const home = tmp('ys-cfg-rollback-');
  try {
    const root = path.join(home, '.yottaskills');
    const oldHub = path.join(root, 'hub');
    const newHub = path.join(root, 'hub2');
    writeSkill(oldHub, 'yotta-demo', '1.0.0');

    const moved = runCli(home, ['hub', 'config', 'set', '--hub', newHub, '--move', '--json']);
    assert.strictEqual(moved.status, 0, moved.stderr);

    const get = runCli(home, ['hub', 'config', 'get', '--json']);
    const getPayload = JSON.parse(get.stdout);
    assert.ok(getPayload.lastMigration, 'lastMigration must be recorded');
    assert.strictEqual(getPayload.lastMigration.kind, 'migrate');
    assert.strictEqual(path.resolve(getPayload.lastMigration.from), path.resolve(oldHub));
    assert.strictEqual(path.resolve(getPayload.lastMigration.to), path.resolve(newHub));
    assert.strictEqual(getPayload.lastMigration.verifiedSkills, 1);
    assert.strictEqual(getPayload.migrationDaysLeft, 7);

    const preview = runCli(home, ['hub', 'config', 'rollback', '--json']);
    assert.strictEqual(preview.status, 0, preview.stderr);
    const previewPayload = JSON.parse(preview.stdout);
    assert.strictEqual(previewPayload.preview, true);
    assert.strictEqual(previewPayload.ok, true);
    assert.strictEqual(path.resolve(previewPayload.current), path.resolve(newHub));
    assert.strictEqual(path.resolve(previewPayload.target), path.resolve(oldHub));
    assert.ok(fs.existsSync(newHub), 'preview must not move anything');

    const rollback = runCli(home, ['hub', 'config', 'rollback', '--yes', '--json']);
    assert.strictEqual(rollback.status, 0, rollback.stderr);
    const payload = JSON.parse(rollback.stdout);
    assert.strictEqual(payload.action, 'config.rollback');
    assert.strictEqual(payload.preview, false);
    assert.ok(fs.existsSync(path.join(oldHub, 'yotta-demo', 'SKILL.md')), 'content must be back at the old hub');
    assert.ok(!fs.existsSync(newHub), 'current hub must be retired to trash');
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.strictEqual(path.resolve(cfg.hub), path.resolve(oldHub));
    assert.strictEqual(cfg.lastMigration.kind, 'rollback');
    assert.ok(cfg.lastMigration.trashedTo, 'rollback must record its own trash target');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI: --move refuses residue-only targets; --clean-residue migrates', () => {
  const home = tmp('ys-cfg-residue-');
  try {
    const root = path.join(home, '.yottaskills');
    const oldHub = path.join(root, 'hub');
    const newHub = path.join(home, 'residue-hub');
    writeSkill(oldHub, 'yotta-demo', '1.0.0');
    fs.mkdirSync(newHub, { recursive: true });
    fs.writeFileSync(path.join(newHub, '.yotta-hub.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(newHub, '.yotta-hub-audit.jsonl'), '', 'utf8');

    const refused = runCli(home, ['hub', 'config', 'set', '--hub', newHub, '--move', '--json']);
    assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /残留/);
    assert.match(refused.stderr, /clean-residue/);
    assert.strictEqual(configLib.readConfig({ homeDir: home, env: {} }).hub, null, 'config must not switch');
    assert.ok(fs.existsSync(path.join(oldHub, 'yotta-demo', 'SKILL.md')), 'old hub must stay intact');

    const cleaned = runCli(home, ['hub', 'config', 'set', '--hub', newHub, '--move', '--clean-residue', '--json']);
    assert.strictEqual(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
    assert.ok(fs.existsSync(path.join(newHub, 'yotta-demo', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(newHub, '.yotta-hub.json')), 'residue must be moved away');
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.strictEqual(path.resolve(cfg.hub), path.resolve(newHub));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI: hub cleanup-backups previews residue, doctor warns, --yes trashes it', () => {
  const home = tmp('ys-cfg-cleanup-');
  try {
    const root = path.join(home, '.yottaskills');
    const hubDir = path.join(root, 'hub');
    writeSkill(hubDir, 'yotta-demo', '1.0.0');
    const hostDir = path.join(home, '.agents', 'skills');
    fs.mkdirSync(hostDir, { recursive: true });
    const hostResidue = path.join(hostDir, 'create-plan.yottaskills-backup-123');
    fs.writeFileSync(hostResidue, 'stale backup\n', 'utf8');
    const hubStaging = path.join(hubDir, '.yottaskills-staging');
    fs.mkdirSync(hubStaging, { recursive: true });

    const doctor = runCli(home, ['hub', 'doctor', '--json']);
    assert.match(doctor.stdout, /backup_residue:/);

    const preview = runCli(home, ['hub', 'cleanup-backups', '--json']);
    assert.strictEqual(preview.status, 0, preview.stderr);
    const previewPayload = JSON.parse(preview.stdout);
    assert.strictEqual(previewPayload.preview, true);
    assert.ok(previewPayload.count >= 2, JSON.stringify(previewPayload));
    assert.ok(fs.existsSync(hostResidue), 'preview must not move anything');

    const applied = runCli(home, ['hub', 'cleanup-backups', '--yes', '--json']);
    assert.strictEqual(applied.status, 0, applied.stderr);
    const appliedPayload = JSON.parse(applied.stdout);
    assert.ok(appliedPayload.moved.length >= 2, JSON.stringify(appliedPayload));
    assert.ok(!fs.existsSync(hostResidue), 'host residue must be gone');
    assert.ok(!fs.existsSync(hubStaging), 'staging residue must be gone');
    for (const item of appliedPayload.moved) {
      assert.ok(fs.existsSync(item.to), 'moved residue must be recoverable in trash: ' + item.to);
    }

    const doctorAfter = runCli(home, ['hub', 'doctor', '--json']);
    assert.ok(!doctorAfter.stdout.includes('backup_residue:'), 'doctor must be clean after cleanup');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
