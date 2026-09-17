'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function hasBash() {
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

test('install.sh --dir 只安装技能本体，不复制开发文件与运行时不相关目录', { skip: !hasBash() }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yotta-skills-install-'));
  const dest = path.join(home, 'skills');
  try {
    const r = spawnSync('bash', ['install.sh', '--dir', dest], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);

    assert.strictEqual(fs.existsSync(path.join(dest, 'yotta-skills', 'SKILL.md')), true);
    assert.strictEqual(fs.existsSync(path.join(dest, 'yotta-skills', 'references', 'skill-list.md')), true);
    assert.strictEqual(fs.existsSync(path.join(dest, 'yotta-skills', 'scripts', 'yotta-skills-mcp.py')), true);

    for (const item of ['.github', '.gitignore', '.npmignore', 'bin', 'lib', 'test', 'package.json', 'install.sh']) {
      assert.strictEqual(fs.existsSync(path.join(dest, 'yotta-skills', item)), false, '不应安装: ' + item);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
