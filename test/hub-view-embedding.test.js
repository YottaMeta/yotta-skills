'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'yotta-skills.js');
const HTML = path.join(ROOT, 'assets', 'view.html');
const START = '// @generated view-html:start';
const END = '// @generated view-html:end';

function embeddedHtml() {
  const source = fs.readFileSync(BIN, 'utf8');
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  assert.ok(start !== -1 && end > start, 'view-html markers must exist');
  const block = source.slice(start, end);
  const match = block.match(/const VIEW_HTML = ("(?:[^"\\]|\\.)*");/);
  assert.ok(match, 'embedded VIEW_HTML string must be found');
  return JSON.parse(match[1]);
}

test('bin/yotta-skills.js embeds assets/view.html byte-for-byte', () => {
  assert.strictEqual(embeddedHtml(), fs.readFileSync(HTML, 'utf8'));
});

test('panel HTML is self-contained and carries the six views plus the CLI page', () => {
  const html = embeddedHtml();
  assert.match(html, /<meta name="yotta-view-token" content="__YOTTA_VIEW_TOKEN__">/);
  for (const view of ['overview', 'hosts', 'adopt', 'links', 'records', 'route', 'cli']) {
    assert.ok(html.includes('id="view-' + view + '"'), 'missing view: ' + view);
  }
  assert.ok(!/https?:\/\//.test(html), 'panel must not reference remote resources');
  assert.ok(!/src="[^"]*\/\//.test(html), 'panel must not load remote assets');
});

test('skill docs document the view entry and its boundaries', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  assert.match(skill, /yotta-skills view/);
  assert.match(skill, /127\.0\.0\.1:8789/);
  const hubRef = fs.readFileSync(path.join(ROOT, 'references', 'hub.md'), 'utf8');
  assert.match(hubRef, /yotta-skills view/);
  assert.match(hubRef, /install \/ update \/ refresh/);
});
