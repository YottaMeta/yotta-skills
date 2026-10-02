'use strict';
/**
 * 测试夹具：零依赖构造 ustar/pax tar（不调用系统 tar），供内置拉包 / 内置解包测试使用。
 */

const zlib = require('zlib');

function tarHeader(name, size, mode, type) {
  const buf = Buffer.alloc(512, 0);
  buf.write(name, 0, 100, 'utf8');
  buf.write(mode.toString(8).padStart(7, '0') + ' ', 100, 8, 'utf8');
  buf.write('0000000 ', 108, 8, 'utf8');
  buf.write('0000000 ', 116, 8, 'utf8');
  buf.write(size.toString(8).padStart(11, '0') + ' ', 124, 12, 'utf8');
  buf.write('00000000000 ', 136, 12, 'utf8');
  buf.write('        ', 148, 8, 'utf8');
  buf.write(type, 156, 1, 'utf8');
  buf.write('ustar', 257, 5, 'utf8');
  buf.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  return buf;
}

/** entries: [{ name, data?, mode?, type? }] */
function makeTar(entries) {
  const parts = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
    const type = entry.type || '0';
    parts.push(tarHeader(entry.name, data.length, entry.mode || 0o644, type));
    parts.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

function makeTgz(entries) {
  return zlib.gzipSync(makeTar(entries));
}

/** 最小合法技能包条目（SKILL.md / package.json / skill-manifest.json）。 */
function packageEntries(pkg) {
  const skillMd = [
    '---',
    'name: ' + pkg.slug,
    'version: ' + pkg.version,
    'description: fixture package for tests',
    'license: MIT',
    '---',
    '',
    '# ' + pkg.slug,
    '',
  ].join('\n');
  const manifest = {
    manifestVersion: 1,
    slug: pkg.slug,
    name: pkg.name || pkg.slug,
    package: pkg.pkg,
    version: pkg.version,
    trust: 'yottameta',
    install: { idempotent: true, network: 'registry' },
    permissions: {
      filesystem: 'user-skills-dir',
      network: 'registry',
      process: 'child-process',
      note: '夹具：测试用最小技能包。',
    },
  };
  return [
    { name: 'package/', type: '5', mode: 0o755, data: '' },
    { name: 'package/SKILL.md', data: skillMd },
    { name: 'package/README.md', data: '# ' + pkg.slug + '\n' },
    { name: 'package/package.json', data: JSON.stringify({ name: pkg.pkg, version: pkg.version }, null, 2) + '\n' },
    { name: 'package/skill-manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' },
  ];
}

module.exports = { tarHeader, makeTar, makeTgz, packageEntries };
