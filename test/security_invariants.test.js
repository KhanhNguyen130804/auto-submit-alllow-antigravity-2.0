'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isLoopbackDebuggerUrl } = require('../cdp_security');
const { parsePidRecord } = require('../process_utils');

test('chỉ chấp nhận WebSocket CDP loopback trên đúng cổng', () => {
  assert.equal(isLoopbackDebuggerUrl('ws://127.0.0.1:9223/devtools/page/abc', 9223), true);
  assert.equal(isLoopbackDebuggerUrl('ws://localhost:9223/devtools/page/abc', 9223), true);
  assert.equal(isLoopbackDebuggerUrl('ws://127.0.0.1:9999/devtools/page/abc', 9223), false);
  assert.equal(isLoopbackDebuggerUrl('ws://192.168.1.10:9223/devtools/page/abc', 9223), false);
  assert.equal(isLoopbackDebuggerUrl('wss://127.0.0.1:9223/devtools/page/abc', 9223), false);
  assert.equal(isLoopbackDebuggerUrl('not-a-url', 9223), false);
});

test('PID record cũ và mới được phân tích an toàn', () => {
  assert.deepEqual(parsePidRecord('123'), { pid: 123, scriptPath: '', startedAt: '' });
  assert.deepEqual(parsePidRecord('{"pid":456,"scriptPath":"D:\\\\tool\\\\auto_submit.js","startedAt":"now"}'), {
    pid: 456, scriptPath: 'D:\\tool\\auto_submit.js', startedAt: 'now'
  });
  assert.equal(parsePidRecord('not-a-pid'), null);
  assert.equal(parsePidRecord('-1'), null);
});

test('toàn bộ project chỉ còn một click và nó nằm sau bước xác minh DOM', () => {
  const root = path.join(__dirname, '..');
  const sourceFiles = fs.readdirSync(root)
    .filter(name => /\.(?:js|py)$/.test(name))
    .map(name => ({ name, content: fs.readFileSync(path.join(root, name), 'utf8') }));
  const clickSites = sourceFiles.flatMap(file =>
    Array.from(file.content.matchAll(/\.click\s*\(/g), match => `${file.name}:${match.index}`)
  );
  assert.equal(clickSites.length, 1);
  assert.match(clickSites[0], /^dom_monitor\.js:/);
  const monitor = sourceFiles.find(file => file.name === 'dom_monitor.js').content;
  assert.match(monitor, /current\.hash !== expectedHash/);
  assert.match(monitor, /current\.button\.click\(\)/);
});
