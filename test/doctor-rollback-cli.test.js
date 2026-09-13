'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const snapshotLib = require('../lib/install-snapshot');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const FAKE_NPM = path.join(__dirname, 'helpers', 'fake-npm.js');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.json'), 'utf8'));
const skills = Array.isArray(manifest) ? manifest : manifest.skills;
const memory = skills.find((skill) => skill.slug === 'yotta-memory');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...(env || {}) },
  });
}

function writeSkill(target, version) {
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'SKILL.md'),
    '---\nname: yotta-memory\nversion: ' + version + '\n---\n',
    'utf8',
  );
}

function isolatedHome() {
  const home = tmpdir('ys-cli-home-');
  return {
    home,
    env: {
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: path.join(home, '.codex'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
    },
  };
}

test('doctor --json reports a healthy installed skill', () => {
  const { home, env } = isolatedHome();
  const dest = tmpdir('ys-doctor-dest-');
  writeSkill(path.join(dest, 'yotta-memory'), memory.version);

  const result = run(['doctor', '--dir', dest, '--slug', 'yotta-memory', '--json'], env);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.checked, 1);
  assert.strictEqual(data.results[0].slug, 'yotta-memory');
  assert.ok(data.results[0].checks.some((check) => check.id === 'skill_file' && check.ok));
  assert.ok(!fs.existsSync(path.join(home, '.yottaskills', 'registry.json')), 'doctor 不应写注册表');
});

test('doctor --json detects a version mismatch without modifying the target', () => {
  const { env } = isolatedHome();
  const dest = tmpdir('ys-doctor-dest-');
  const target = path.join(dest, 'yotta-memory');
  writeSkill(target, '0.0.1');

  const result = run(['doctor', '--dir', dest, '--slug', 'yotta-memory', '--json'], env);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, false);
  assert.ok(data.errors.some((item) => /版本不一致/.test(item)));
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /0\.0\.1/);
});

test('doctor refuses to execute a custom doctor from an untrusted manifest', () => {
  const { env } = isolatedHome();
  const dest = tmpdir('ys-doctor-dest-');
  const target = path.join(dest, 'yotta-memory');
  writeSkill(target, memory.version);
  const lifecycleDir = path.join(target, 'scripts', 'lifecycle');
  fs.mkdirSync(lifecycleDir, { recursive: true });
  const marker = path.join(target, '.doctor-ran');
  fs.writeFileSync(path.join(lifecycleDir, 'doctor.js'), [
    "const fs = require('fs');",
    'const marker = ' + JSON.stringify(marker) + ';',
    "fs.writeFileSync(marker, 'yes');",
    "process.stdout.write(JSON.stringify({ok:true}));",
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(target, 'skill-manifest.json'), JSON.stringify({
    manifestVersion: 1,
    slug: 'yotta-memory',
    name: '元忆',
    package: memory.pkg,
    version: memory.version,
    trust: 'unknown',
    install: { idempotent: true, doctor: 'scripts/lifecycle/doctor.js' },
    permissions: { filesystem: 'user-skills-dir', network: 'none' },
  }, null, 2), 'utf8');

  const result = run(['doctor', '--dir', dest, '--slug', 'yotta-memory', '--json'], env);
  assert.strictEqual(result.status, 6, result.stdout + result.stderr);
  assert.ok(!fs.existsSync(marker), '不可信 manifest 的 doctor 不应执行');
});

test('rollback --list --json lists valid snapshots', () => {
  const { home, env } = isolatedHome();
  const dest = tmpdir('ys-rollback-dest-');
  const target = path.join(dest, 'yotta-memory');
  writeSkill(target, memory.version);
  const created = snapshotLib.createSnapshot(target, {
    homeDir: home,
    slug: 'yotta-memory',
    version: memory.version,
  });

  const result = run(['rollback', '--list', '--dir', dest, '--slug', 'yotta-memory', '--json'], env);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.count, 1);
  assert.strictEqual(data.snapshots[0].path, created.path);
  assert.strictEqual(data.snapshots[0].valid, true);
});

test('rollback --slug restores the latest snapshot and writes evidence', () => {
  const { home, env } = isolatedHome();
  const dest = tmpdir('ys-rollback-dest-');
  const target = path.join(dest, 'yotta-memory');
  writeSkill(target, memory.version);
  const created = snapshotLib.createSnapshot(target, {
    homeDir: home,
    slug: 'yotta-memory',
    version: memory.version,
  });
  fs.rmSync(target, { recursive: true, force: true });
  writeSkill(target, '9.9.9');

  const result = run(['rollback', '--dir', dest, '--slug', 'yotta-memory', '--json'], env);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.snapshot, created.path);
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), new RegExp('version: ' + memory.version));
  assert.ok(fs.existsSync(created.path), '回滚后快照仍应保留');
  const evidence = fs.readFileSync(path.join(home, '.yottaskills', 'install-log.jsonl'), 'utf8');
  assert.match(evidence, /"event":"rollback"/);
});

test('rollback refuses a tampered snapshot and preserves the current target', () => {
  const { home, env } = isolatedHome();
  const dest = tmpdir('ys-rollback-dest-');
  const target = path.join(dest, 'yotta-memory');
  writeSkill(target, memory.version);
  const created = snapshotLib.createSnapshot(target, {
    homeDir: home,
    slug: 'yotta-memory',
    version: memory.version,
  });
  fs.appendFileSync(path.join(created.path, 'SKILL.md'), '\ntampered\n', 'utf8');
  fs.rmSync(target, { recursive: true, force: true });
  writeSkill(target, '9.9.9');

  const result = run(['rollback', '--dir', dest, '--slug', 'yotta-memory', '--json'], env);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, false);
  assert.ok(data.errors.some((item) => /摘要不一致/.test(item)));
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /9\.9\.9/);
});

test('rollback rejects an unsafe slug before touching the filesystem', () => {
  const { env } = isolatedHome();
  const dest = tmpdir('ys-rollback-dest-');
  const result = run(['rollback', '--dir', dest, '--slug', '../outside', '--json'], env);
  assert.strictEqual(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /slug/);
});

test('install executes package-local setup and doctor before committing', () => {
  const { env } = isolatedHome();
  const dest = tmpdir('ys-lifecycle-install-');
  const fixture = tmpdir('ys-lifecycle-fixture-');
  const lifecycleDir = path.join(fixture, 'lifecycle');
  fs.mkdirSync(lifecycleDir, { recursive: true });
  fs.writeFileSync(path.join(lifecycleDir, 'setup.js'), [
    "const fs = require('fs');",
    "const args = process.argv.slice(2);",
    "const skillDir = args[args.indexOf('--skill-dir') + 1];",
    "fs.writeFileSync(require('path').join(skillDir, '.setup-ran'), 'yes');",
    "process.stdout.write(JSON.stringify({ok:true}));",
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(lifecycleDir, 'doctor.js'), [
    "const fs = require('fs');",
    "const args = process.argv.slice(2);",
    "const skillDir = args[args.indexOf('--skill-dir') + 1];",
    "const ok = fs.existsSync(require('path').join(skillDir, '.setup-ran'));",
    "process.stdout.write(JSON.stringify({ok:ok,error:ok?null:'setup marker missing'}));",
  ].join('\n'), 'utf8');
  const manifestFile = path.join(fixture, 'skill-manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({
    manifestVersion: 1,
    slug: 'yotta-memory',
    name: '元忆',
    package: memory.pkg,
    version: memory.version,
    trust: 'yottameta',
    install: {
      idempotent: true,
      setup: 'scripts/lifecycle/setup.js',
      doctor: 'scripts/lifecycle/doctor.js',
    },
    permissions: { filesystem: 'user-skills-dir', network: 'registry' },
  }, null, 2), 'utf8');

  const result = run(
    ['install', 'yotta-memory', '--dir', dest, '--pin', '--skip-scan', '--no-reindex'],
    {
      ...env,
      YOTTA_SKILLS_NPM: FAKE_NPM,
      YOTTA_SKILLS_FAKE_MANIFEST_FILE: manifestFile,
      YOTTA_SKILLS_FAKE_LIFECYCLE_DIR: lifecycleDir,
    },
  );
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(fs.existsSync(path.join(dest, 'yotta-memory', '.setup-ran')));
});
