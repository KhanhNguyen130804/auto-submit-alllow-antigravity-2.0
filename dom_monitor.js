'use strict';

function createInjectedScript(options = {}) {
  const bindingName = options.bindingName || '__antigravityReportCandidate';
  const cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : 1500;
  const reportIntervalMs = Number.isFinite(options.reportIntervalMs) ? options.reportIntervalMs : 15000;

  return `
(() => {
  if (window.__autoSubmitSafetyMonitorInstalled) return 'already_installed';
  window.__autoSubmitSafetyMonitorInstalled = true;

  const BINDING_NAME = ${JSON.stringify(bindingName)};
  const COOLDOWN = ${cooldownMs};
  const REPORT_INTERVAL = ${reportIntervalMs};
  const APPROVE_TEXTS = new Set(['Submit', 'Allow', 'Allow Once', 'Always Allow', 'Proceed']);
  const DENY_TEXTS = new Set(['Skip', 'Deny', 'Cancel']);
  const records = new Map();
  const buttonIds = new WeakMap();
  const installPrefix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let sequence = 0;

  function normalizeText(value) {
    return String(value || '').replace(/\\s+/g, ' ').trim();
  }

  function textOf(node) {
    return normalizeText(node && (node.innerText || node.textContent || ''));
  }

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function getAllDocuments(root = document) {
    const docs = [root];
    try {
      for (const frame of root.querySelectorAll('iframe, frame')) {
        try {
          const child = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
          if (child && !docs.includes(child)) docs.push(...getAllDocuments(child));
        } catch (error) {}
      }
    } catch (error) {}
    return docs;
  }

  function findContainer(button) {
    const selector = '[role="dialog"], [aria-modal="true"], [data-testid*="approval" i], [data-testid*="permission" i], [class*="approval" i], [class*="permission" i], [class*="dialog" i], [class*="modal" i]';
    try {
      const direct = button.closest(selector);
      if (direct) return direct;
    } catch (error) {}

    let current = button.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      try {
        const buttons = Array.from(current.querySelectorAll('button'));
        const hasDeny = buttons.some(item => DENY_TEXTS.has(textOf(item)));
        const content = textOf(current).toLowerCase();
        if (hasDeny || /requires your approval|do you want to run|allow checking|permission to run|allow this time/.test(content)) {
          return current;
        }
      } catch (error) {}
    }
    return null;
  }

  function cleanCommand(value) {
    const lines = String(value || '').split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length !== 1) return '';
    return lines[0]
      .replace(/^(?:command|lệnh)\\s*:\\s*/i, '')
      .replace(/^PS\\s+[^>]+>\\s*/i, '')
      .replace(/^(?:\\$|>)\\s+/, '')
      .trim();
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function extractCommand(container) {
    const selector = '[data-command], [data-testid*="command" i], [aria-label*="command" i], pre, code';
    let nodes = [];
    try { nodes = Array.from(container.querySelectorAll(selector)); } catch (error) {}
    const explicit = unique(nodes.map(node => cleanCommand(node.getAttribute && node.getAttribute('data-command') || textOf(node))));
    if (explicit.length === 1) return { value: explicit[0], reason: '' };
    if (explicit.length > 1) return { value: '', reason: 'multiple-command-candidates' };

    const raw = String(container.innerText || container.textContent || '');
    const labelled = raw.match(/(?:^|\\n)\\s*(?:command|lệnh)\\s*:\\s*([^\\r\\n]+)/i);
    const fallback = labelled ? cleanCommand(labelled[1]) : '';
    return fallback
      ? { value: fallback, reason: '' }
      : { value: '', reason: 'command-not-found' };
  }

  function extractCwd(container) {
    const selector = '[data-cwd], [data-testid*="cwd" i], [data-testid*="working-directory" i], [class*="working-directory" i], [class~="cwd" i]';
    let nodes = [];
    try { nodes = Array.from(container.querySelectorAll(selector)); } catch (error) {}
    const explicit = unique(nodes.map(node => normalizeText(node.getAttribute && node.getAttribute('data-cwd') || textOf(node))));
    if (explicit.length === 1) return explicit[0].replace(/^(?:cwd|working directory|thư mục làm việc)\\s*:\\s*/i, '');
    if (explicit.length > 1) return '';

    const raw = String(container.innerText || container.textContent || '');
    const match = raw.match(/(?:cwd|working directory|thư mục làm việc)\\s*:\\s*([^\\r\\n]+)/i);
    return match ? normalizeText(match[1]) : '';
  }

  function stableDialogText(container) {
    let value = textOf(container);
    try {
      for (const button of container.querySelectorAll('button')) {
        const label = textOf(button);
        if (label) value = value.replace(label, '');
      }
    } catch (error) {}
    return normalizeText(value);
  }

  function isApprovalDialog(container) {
    let buttons = [];
    try { buttons = Array.from(container.querySelectorAll('button')); } catch (error) {}
    const approveCount = buttons.filter(button => APPROVE_TEXTS.has(textOf(button))).length;
    const hasDeny = buttons.some(button => DENY_TEXTS.has(textOf(button)));
    const content = textOf(container).toLowerCase();
    const hasApprovalText = /requires your approval|do you want to run|allow checking|permission to run|allow this time|tell the agent what to do instead/.test(content);
    return approveCount === 1 && (hasDeny || hasApprovalText);
  }

  function isClickable(button) {
    if (!button || !button.isConnected || button.disabled) return false;
    if (button.getAttribute && (button.getAttribute('aria-disabled') === 'true' || button.getAttribute('aria-hidden') === 'true')) return false;
    if (typeof button.getClientRects === 'function' && button.getClientRects().length === 0) return false;
    return true;
  }

  function buildCandidate(button) {
    const container = findContainer(button);
    if (!container || !isApprovalDialog(container)) return null;
    const command = extractCommand(container);
    const cwd = extractCwd(container);
    const stableText = stableDialogText(container);
    const hash = hashText(command.value + '\\n' + cwd + '\\n' + stableText);
    return { container, button, command: command.value, cwd, extractionReason: command.reason, hash };
  }

  function candidateId(button) {
    if (!buttonIds.has(button)) buttonIds.set(button, installPrefix + '-' + (++sequence));
    return buttonIds.get(button);
  }

  function reportCandidate(candidate) {
    const id = candidateId(candidate.button);
    const existing = records.get(id);
    const now = Date.now();
    records.set(id, { ...candidate, id, lastReportedAt: existing ? existing.lastReportedAt : 0, lastApprovedAt: existing ? existing.lastApprovedAt : 0 });
    const record = records.get(id);
    if (record.hash === (existing && existing.hash) && now - record.lastReportedAt < REPORT_INTERVAL) return;
    record.lastReportedAt = now;
    try {
      const binding = window[BINDING_NAME];
      if (typeof binding !== 'function') return;
      binding(JSON.stringify({
        version: 1,
        candidateId: id,
        hash: candidate.hash,
        command: candidate.command || null,
        cwd: candidate.cwd || null,
        extractionReason: candidate.extractionReason || null,
        pageUrl: String(location.href || '')
      }));
    } catch (error) {}
  }

  function scan() {
    for (const doc of getAllDocuments()) {
      let buttons = [];
      try { buttons = Array.from(doc.querySelectorAll('button')); } catch (error) {}
      for (const button of buttons) {
        if (!APPROVE_TEXTS.has(textOf(button))) continue;
        const candidate = buildCandidate(button);
        if (candidate) reportCandidate(candidate);
      }
    }
  }

  window.__autoSubmitApprove = function approveCandidate(id, expectedHash) {
    const record = records.get(id);
    if (!record) return { ok: false, reason: 'candidate-not-found' };
    if (Date.now() - record.lastApprovedAt < COOLDOWN) return { ok: false, reason: 'candidate-cooldown' };
    const current = buildCandidate(record.button);
    if (!current) return { ok: false, reason: 'dialog-no-longer-valid' };
    if (current.hash !== expectedHash || current.command !== record.command || current.cwd !== record.cwd) {
      return { ok: false, reason: 'candidate-changed' };
    }
    if (!isClickable(current.button)) return { ok: false, reason: 'button-not-clickable' };
    record.lastApprovedAt = Date.now();
    current.button.click();
    return { ok: true, reason: 'approved' };
  };

  setInterval(scan, 250);
  const observer = new MutationObserver(scan);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scan();
  return 'installed';
})()
`;
}

module.exports = { createInjectedScript };
