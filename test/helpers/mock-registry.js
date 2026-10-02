'use strict';
/**
 * 测试夹具：本地 mock npm registry（packument + tarball），零依赖、只监听 127.0.0.1。
 * pkgs: [{ slug, pkg, version, name?, integrity?: 'valid'|'bad'|'missing', shasum?: 'valid'|'bad'|'missing', extraFiles? }]
 */

const http = require('http');
const crypto = require('crypto');
const { makeTgz, packageEntries } = require('./tar-fixture');

function digestBase64(buffer, algo) {
  return crypto.createHash(algo).update(buffer).digest('base64');
}

function digestHex(buffer, algo) {
  return crypto.createHash(algo).update(buffer).digest('hex');
}

async function startMockRegistry(pkgs) {
  const state = new Map();
  const server = http.createServer((req, res) => {
    const decoded = decodeURIComponent(String(req.url || '').replace(/^\//, ''));
    if (decoded.startsWith('tarballs/')) {
      const file = decoded.slice('tarballs/'.length);
      const item = [...state.values()].find((candidate) => candidate.file === file);
      if (!item) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(item.tgz);
      return;
    }
    const item = state.get(decoded);
    if (!item) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(item.packument));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  for (const spec of pkgs) {
    const entries = packageEntries({
      slug: spec.slug,
      pkg: spec.pkg,
      version: spec.version,
      name: spec.name,
    });
    if (spec.extraFiles) entries.push(...spec.extraFiles);
    const tgz = makeTgz(entries);
    const file = spec.slug + '-' + spec.version + '.tgz';
    const dist = { tarball: 'http://127.0.0.1:' + port + '/tarballs/' + file };
    if (spec.integrity !== 'missing') {
      dist.integrity = 'sha512-' + (spec.integrity === 'bad'
        ? digestBase64(Buffer.from('tampered'), 'sha512')
        : digestBase64(tgz, 'sha512'));
    }
    if (spec.shasum !== 'missing') {
      dist.shasum = spec.shasum === 'bad'
        ? digestHex(Buffer.from('tampered'), 'sha1')
        : digestHex(tgz, 'sha1');
    }
    state.set(spec.pkg, {
      file,
      tgz,
      packument: {
        name: spec.pkg,
        'dist-tags': { latest: spec.version },
        versions: { [spec.version]: { name: spec.pkg, version: spec.version, dist } },
      },
    });
  }

  return {
    port,
    url: 'http://127.0.0.1:' + port + '/',
    close: () => new Promise((resolve) => server.close(resolve)),
    tarballs: state,
  };
}

module.exports = { startMockRegistry };
