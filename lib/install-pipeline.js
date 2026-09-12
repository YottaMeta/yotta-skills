'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const manifestLib = require('./manifest');
const gateLib = require('./verify-gate');

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyTree(src, dst, copyDir) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  copyDir(src, dst);
}

function restoreBackup(target, backup) {
  if (!backup || !fs.existsSync(backup)) return;
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(backup, target);
}

function createInstaller(deps) {
  const homeDir = deps.homeDir || os.homedir();

  function record(entry) {
    return deps.appendEvidence(entry, { homeDir });
  }

  function safeRecord(entry) {
    try {
      return record(entry);
    } catch (_) {
      return null;
    }
  }

  return function installOne(skill, dest, opts) {
    const target = path.join(dest, skill.slug);
    const existingVersion = deps.readInstalledVersion(target);
    if (!opts.force && existingVersion === skill.version) {
      return { skill, status: 'skip', version: existingVersion, note: '已是最新', exitCode: 0 };
    }

    let tmp = null;
    let staged = null;
    let snapshot = null;
    let backup = null;
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-skills-'));
      const packDir = path.join(tmp, 'pack');
      fs.mkdirSync(packDir, { recursive: true });
      const packed = deps.runNpmPack(skill, opts, packDir);
      if (packed.error) {
        safeRecord({ event: 'before_install', skill: skill.slug, decision: 'fail', error: packed.error });
        return { skill, status: 'fail', version: null, note: packed.error, exitCode: 1 };
      }

      const extractDir = path.join(tmp, 'extract');
      fs.mkdirSync(extractDir, { recursive: true });
      const extracted = deps.extractTarball(packed.tarball, extractDir);
      if (extracted.error) {
        safeRecord({ event: 'before_install', skill: skill.slug, decision: 'fail', error: extracted.error });
        return { skill, status: 'fail', version: packed.resolved, note: extracted.error, exitCode: 1 };
      }

      const loaded = manifestLib.loadManifest({ pkgDir: extracted.pkgDir, skill });
      if (loaded.errors.length > 0) {
        const note = loaded.errors.join('; ');
        safeRecord({ event: 'manifest', skill: skill.slug, decision: 'block', errors: loaded.errors });
        return { skill, status: 'fail', version: packed.resolved, note, exitCode: 6 };
      }

      let gate;
      let scan;
      if (opts.skipScan) {
        gate = { ok: true, engine: null, mode: 'explicit-unverified' };
        scan = { decision: 'unverified', verdict: null, counts: null, warn: true, mode: 'explicit-unverified' };
      } else {
        gate = deps.ensureGate({ skill, extracted, dest, opts });
        if (!gate.ok) {
          safeRecord({ event: 'before_install', skill: skill.slug, decision: 'block', error: gate.error });
          return { skill, status: 'fail', version: packed.resolved, note: gate.error, exitCode: 5 };
        }
        const scanResult = deps.scanTarget(gate.engine, extracted.pkgDir);
        if (!scanResult.ok) {
          safeRecord({ event: 'before_install', skill: skill.slug, decision: 'block', error: scanResult.error });
          return { skill, status: 'fail', version: packed.resolved, note: scanResult.error, exitCode: 5 };
        }
        const verdict = gateLib.evaluateVerdict(scanResult.verdict);
        if (verdict.block) {
          safeRecord({
            event: 'before_install',
            skill: skill.slug,
            decision: 'block',
            verdict: scanResult.verdict,
            counts: scanResult.counts,
          });
          return {
            skill,
            status: 'fail',
            version: packed.resolved,
            note: '元信 verdict: ' + scanResult.verdict,
            exitCode: 5,
          };
        }
        scan = {
          decision: verdict.decision,
          verdict: scanResult.verdict,
          counts: scanResult.counts,
          warn: verdict.warn,
        };
      }

      fs.mkdirSync(dest, { recursive: true });
      const stagingRoot = path.join(dest, '.yottaskills-staging');
      fs.mkdirSync(stagingRoot, { recursive: true });
      staged = fs.mkdtempSync(path.join(stagingRoot, skill.slug + '-'));
      copyTree(extracted.pkgDir, staged, deps.copyDir);

      if (fs.existsSync(target)) {
        const snapshotRoot = path.join(homeDir, '.yottaskills', 'snapshots', skill.slug);
        fs.mkdirSync(snapshotRoot, { recursive: true });
        snapshot = fs.mkdtempSync(path.join(snapshotRoot, nowTag() + '-' + (existingVersion || 'unknown') + '-'));
        copyTree(target, snapshot, deps.copyDir);
        backup = path.join(dest, '.yottaskills-backup-' + skill.slug + '-' + process.pid);
        fs.renameSync(target, backup);
      }

      fs.renameSync(staged, target);
      staged = null;

      let evidence;
      try {
        evidence = record({
          event: 'before_install',
          skill: skill.slug,
          package: skill.pkg,
          version: packed.resolved || skill.version,
          gate_mode: gate.mode,
          verdict: scan.verdict,
          decision: scan.decision,
          snapshot,
        });
      } catch (error) {
        restoreBackup(target, backup);
        backup = null;
        return { skill, status: 'fail', version: packed.resolved, note: '证据写入失败: ' + error.message, exitCode: 1 };
      }

      if (backup && fs.existsSync(backup)) {
        try {
          fs.rmSync(backup, { recursive: true, force: true });
        } catch (_) {
          // The new version is already active; a stale backup is safer than a failed install.
        }
        backup = null;
      }

      return {
        skill,
        status: 'ok',
        version: packed.resolved || skill.version,
        note: null,
        gate: { ...scan, mode: gate.mode },
        evidence,
        exitCode: 0,
      };
    } catch (error) {
      restoreBackup(target, backup);
      backup = null;
      safeRecord({ event: 'install', skill: skill.slug, decision: 'fail', error: error.message });
      return { skill, status: 'fail', version: null, note: error.message, exitCode: 1 };
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      if (staged) fs.rmSync(staged, { recursive: true, force: true });
    }
  };
}

module.exports = { createInstaller };
