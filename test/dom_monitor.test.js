'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createInjectedScript } = require('../dom_monitor');

function makeDom() {
  const reports = [];
  let clicks = 0;
  const commandNode = { innerText: 'git status', getAttribute: () => null };
  const cwdNode = { innerText: 'D:\\work\\safe-project', getAttribute: () => null };
  let container;
  const approve = {
    innerText: 'Allow', isConnected: true, disabled: false, parentElement: null,
    closest: () => container,
    getAttribute: () => null,
    getClientRects: () => [1],
    click: () => { clicks += 1; }
  };
  const deny = { innerText: 'Deny', getAttribute: () => null };
  container = {
    innerText: 'Command: git status\nWorking directory: D:\\work\\safe-project\nRequires your approval\nAllow\nDeny',
    querySelectorAll(selector) {
      if (selector === 'button') return [approve, deny];
      if (selector.includes('[data-command]')) return [commandNode];
      if (selector.includes('[data-cwd]')) return [cwdNode];
      return [];
    }
  };
  approve.parentElement = container;
  const document = {
    body: container,
    querySelectorAll(selector) {
      if (selector === 'button') return [approve, deny];
      if (selector === 'iframe, frame') return [];
      return [];
    }
  };
  const window = {
    __testReport: payload => reports.push(JSON.parse(payload))
  };
  const context = {
    window,
    document,
    location: { href: 'https://local.test/' },
    MutationObserver: class { observe() {} },
    setInterval: () => 1,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap
  };
  return { context, window, reports, commandNode, getClicks: () => clicks };
}

test('nội dung thay đổi sau đánh giá làm bước click bị hủy', () => {
  const dom = makeDom();
  const script = createInjectedScript({ bindingName: '__testReport', cooldownMs: 0 });
  vm.runInNewContext(script, dom.context);
  assert.equal(dom.reports.length, 1);
  const candidate = dom.reports[0];
  dom.commandNode.innerText = 'Remove-Item important.txt';
  const result = dom.window.__autoSubmitApprove(candidate.candidateId, candidate.hash);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'candidate-changed');
  assert.equal(dom.getClicks(), 0);
});

test('hộp thoại không đổi chỉ click qua hàm xác minh duy nhất', () => {
  const dom = makeDom();
  const script = createInjectedScript({ bindingName: '__testReport', cooldownMs: 0 });
  vm.runInNewContext(script, dom.context);
  const candidate = dom.reports[0];
  const result = dom.window.__autoSubmitApprove(candidate.candidateId, candidate.hash);
  assert.equal(result.ok, true);
  assert.equal(dom.getClicks(), 1);
});
