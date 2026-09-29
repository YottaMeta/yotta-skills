'use strict';

// 测试用假 provider：只读 stdin、按 argv 模式返回固定响应；不联网、不写文件。
const fs = require('fs');

const mode = process.argv[2] || 'ok';
const argData = process.argv[3] || '';
let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch (e) {
  raw = '';
}
let request = null;
try {
  request = JSON.parse(raw || '{}');
} catch (e) {
  request = null;
}

function send(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

if (mode === 'hang') {
  setTimeout(() => process.exit(0), 10000);
} else if (mode === 'exit') {
  process.exit(3);
} else if (mode === 'invalid') {
  process.stdout.write('not-json');
  process.exit(0);
} else if (mode === 'oversize') {
  process.stdout.write(JSON.stringify({ ok: true, data: { pad: 'x'.repeat(300 * 1024) } }));
  process.exit(0);
} else if (mode === 'license') {
  send({ ok: false, code: 'license_required', message: '需要授权后使用' });
} else if (mode === 'custom') {
  let data = {};
  try {
    data = JSON.parse(argData || '{}');
  } catch (e) {
    data = {};
  }
  send({ ok: true, capability: request && request.capability, data });
} else if (mode === 'env') {
  send({
    ok: true,
    capability: request && request.capability,
    data: {
      env: {
        home: process.env.YOTTA_LICENSE_HOME || '',
        keys: process.env.YOTTA_LICENSE_KEYS_DIR || '',
        baseUrl: process.env.YOTTA_LICENSE_BASE_URL || '',
        serverId: process.env.YOTTA_LICENSE_SERVER_ID || '',
      },
    },
  });
} else {
  const capability = request && request.capability;
  if (capability === 'o1.route') {
    send({
      ok: true,
      capability,
      data: { skills: [{ slug: 'yotta-memory' }, { slug: 'yotta-present' }, { slug: 'ghost-skill' }] },
    });
  } else if (capability === 'memory.hook') {
    const candidates = ((request.payload || {}).candidates) || [];
    send({ ok: true, capability, data: { evict: candidates.slice(0, 1).map((item) => item.file) } });
  } else {
    send({ ok: false, code: 'unsupported', message: '不支持的能力' });
  }
}
