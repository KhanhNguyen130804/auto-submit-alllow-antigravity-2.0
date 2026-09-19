/**
 * Antigravity Auto-Submit Daemon (Safety-First Dual-Engine)
 * DOM phát hiện ứng viên -> Node.js đánh giá policy -> DOM xác minh hash -> click.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createAuditLogger } = require('./audit_logger');
const { isLoopbackDebuggerUrl } = require('./cdp_security');
const { evaluateCommand } = require('./command_policy');
const { createInjectedScript } = require('./dom_monitor');
const { isExpectedDaemon, parsePidRecord } = require('./process_utils');

const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
const SCRIPT_PATH = path.resolve(__filename);
const PID_PATH = path.join(__dirname, 'auto_submit.pid');
const BINDING_NAME = '__antigravityReportCandidate';
const CHECK_INTERVAL_MS = 3000;
const SUBMIT_COOLDOWN_MS = 1500;
const CDP_TIMEOUT_MS = 2500;

const TARGET_CONFIGS = [
  { id: 'desktop', name: 'Antigravity Desktop 2.0', portFile: path.join(APPDATA, 'Antigravity', 'DevToolsActivePort'), fallbackPort: null },
  { id: 'ide', name: 'Antigravity IDE 2.0', portFile: path.join(APPDATA, 'Antigravity IDE', 'DevToolsActivePort'), fallbackPort: 9223 }
];

const INJECTED_SCRIPT = createInjectedScript({ bindingName: BINDING_NAME, cooldownMs: SUBMIT_COOLDOWN_MS });
const audit = createAuditLogger({ logPath: path.join(__dirname, 'security-audit.log') });
const activeSockets = new Map();
let isRunning = true;
let lastWaitingLogTime = 0;

function log(message) {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  console.log(`[${time}] ${message}`);
}

function acquireSingleton() {
  if (fs.existsSync(PID_PATH)) {
    let existing = null;
    try { existing = parsePidRecord(fs.readFileSync(PID_PATH, 'utf8')); } catch (error) {}
    const expectedPath = existing && existing.scriptPath ? existing.scriptPath : SCRIPT_PATH;
    if (existing && isExpectedDaemon(existing.pid, expectedPath)) {
      console.error(`[LỖI] Auto-Submit đang chạy với PID ${existing.pid}. Không khởi động thêm tiến trình.`);
      process.exit(2);
    }
    try { fs.unlinkSync(PID_PATH); } catch (error) {}
  }

  const record = JSON.stringify({ pid: process.pid, scriptPath: SCRIPT_PATH, startedAt: new Date().toISOString() });
  try {
    fs.writeFileSync(PID_PATH, record, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    console.error('[LỖI] Không thể tạo PID lock. Một tiến trình khác có thể đang khởi động.');
    process.exit(2);
  }
}

function cleanPid() {
  try {
    if (!fs.existsSync(PID_PATH)) return;
    const record = parsePidRecord(fs.readFileSync(PID_PATH, 'utf8'));
    if (record && record.pid === process.pid) fs.unlinkSync(PID_PATH);
  } catch (error) {}
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function getTargetPort(target) {
  if (fs.existsSync(target.portFile)) {
    try {
      const firstLine = fs.readFileSync(target.portFile, 'utf8').split(/\r?\n/)[0].trim();
      const port = Number.parseInt(firstLine, 10);
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    } catch (error) {}
  }
  if (target.fallbackPort) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${target.fallbackPort}/json/version`, 600);
      if (response.ok) return target.fallbackPort;
    } catch (error) {}
  }
  return null;
}

function sendCdp(info, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    if (!info.ws || info.ws.readyState !== WebSocket.OPEN) return reject(new Error('WebSocket is not open'));
    const id = ++info.nextMessageId;
    const timer = setTimeout(() => {
      info.pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, CDP_TIMEOUT_MS);
    info.pending.set(id, { resolve, reject, timer });
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    try { info.ws.send(JSON.stringify(message)); }
    catch (error) {
      clearTimeout(timer);
      info.pending.delete(id);
      reject(error);
    }
  });
}

async function installMonitor(info, sessionId) {
  const commands = [
    ['Runtime.enable', {}],
    ['Runtime.addBinding', { name: BINDING_NAME }],
    ['Page.addScriptToEvaluateOnNewDocument', { source: INJECTED_SCRIPT }],
    ['Runtime.evaluate', { expression: INJECTED_SCRIPT, returnByValue: true }]
  ];
  for (const [method, params] of commands) {
    try { await sendCdp(info, method, params, sessionId); }
    catch (error) {
      if (method !== 'Page.addScriptToEvaluateOnNewDocument') throw error;
    }
  }
}

function auditDecision(info, decision, action, reasonOverride) {
  const written = audit.write({
    target: info.target.name,
    page: info.title,
    risk: decision.risk,
    action,
    ruleId: decision.ruleId,
    reason: reasonOverride || decision.reason,
    command: decision.redactedCommand
  });
  if (!written) log('⚠️ Không thể ghi security-audit.log.');
}

function validCandidatePayload(payload) {
  return payload && payload.version === 1 &&
    typeof payload.candidateId === 'string' && payload.candidateId.length <= 160 &&
    typeof payload.hash === 'string' && /^[a-f0-9]{8}$/i.test(payload.hash) &&
    (payload.command === null || (typeof payload.command === 'string' && payload.command.length <= 20000)) &&
    (payload.cwd === null || (typeof payload.cwd === 'string' && payload.cwd.length <= 2000));
}

async function handleCandidate(info, params, sessionId) {
  let payload;
  try { payload = JSON.parse(params.payload); } catch (error) { return; }
  if (!validCandidatePayload(payload)) return;

  const candidateKey = `${sessionId || 'root'}::${payload.candidateId}`;
  if (info.handledCandidates.get(candidateKey) === payload.hash) return;
  info.handledCandidates.set(candidateKey, payload.hash);
  if (info.handledCandidates.size > 1000) info.handledCandidates.delete(info.handledCandidates.keys().next().value);

  const decision = evaluateCommand({ command: payload.command, cwd: payload.cwd, target: info.target.name });
  if (!decision.autoApprove) {
    auditDecision(info, decision, 'manual_review');
    log(`🛡️ [${info.target.name}] Duyệt thủ công (${decision.risk}/${decision.ruleId}): ${decision.redactedCommand || '[không đọc được lệnh]'}`);
    return;
  }

  const expression = `window.__autoSubmitApprove(${JSON.stringify(payload.candidateId)}, ${JSON.stringify(payload.hash)})`;
  const evaluateParams = { expression, returnByValue: true };
  if (Number.isInteger(params.executionContextId)) evaluateParams.contextId = params.executionContextId;
  try {
    const response = await sendCdp(info, 'Runtime.evaluate', evaluateParams, sessionId);
    const result = response.result && response.result.result && response.result.result.value;
    if (result && result.ok === true) {
      auditDecision(info, decision, 'auto_approved');
      log(`✅ [${info.target.name}] Tự duyệt lệnh mức thấp (${decision.ruleId}): ${decision.redactedCommand}`);
    } else {
      const reason = result && result.reason ? result.reason : 'verification-failed';
      auditDecision(info, decision, 'approval_aborted', `Không click vì bước xác minh lại thất bại: ${reason}`);
      log(`🛡️ [${info.target.name}] Hủy auto-approve vì hộp thoại đã thay đổi (${reason}).`);
    }
  } catch (error) {
    auditDecision(info, decision, 'approval_aborted', `Không click vì lỗi CDP: ${error.message}`);
  }
}

async function handleMessage(info, event) {
  let data;
  try { data = JSON.parse(event.data); } catch (error) { return; }
  if (data.id && info.pending.has(data.id)) {
    const pending = info.pending.get(data.id);
    info.pending.delete(data.id);
    clearTimeout(pending.timer);
    if (data.error) pending.reject(new Error(data.error.message || 'CDP error'));
    else pending.resolve(data);
    return;
  }
  if (data.method === 'Runtime.bindingCalled' && data.params && data.params.name === BINDING_NAME) {
    await handleCandidate(info, data.params, data.sessionId);
    return;
  }
  if (data.method === 'Target.attachedToTarget') {
    const sessionId = data.params && data.params.sessionId;
    const type = data.params && data.params.targetInfo && data.params.targetInfo.type;
    if (sessionId && ['page', 'iframe', 'webview'].includes(type)) {
      try { await installMonitor(info, sessionId); } catch (error) {}
    }
  }
}

async function connectToPage(target, page, port) {
  const socketKey = `${target.id}::${page.id}`;
  if (activeSockets.has(socketKey)) return;
  if (!isLoopbackDebuggerUrl(page.webSocketDebuggerUrl, port)) {
    log(`⚠️ [${target.name}] Bỏ qua debugger URL không thuộc loopback hoặc sai cổng.`);
    return;
  }
  const title = page.title || 'Untitled';
  let ws;
  try { ws = new WebSocket(page.webSocketDebuggerUrl); } catch (error) { return; }
  const info = { ws, target, title, port, nextMessageId: 100, pending: new Map(), handledCandidates: new Map() };
  activeSockets.set(socketKey, info);

  ws.onopen = async () => {
    log(`✅ [${target.name}] Kết nối an toàn tới "${title}" (Port ${port}).`);
    try {
      await sendCdp(info, 'Page.enable');
      await sendCdp(info, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      await installMonitor(info);
    } catch (error) {
      log(`⚠️ [${target.name}] Không thể cài bộ giám sát an toàn: ${error.message}`);
    }
  };
  ws.onmessage = event => { handleMessage(info, event).catch(() => {}); };
  ws.onclose = () => {
    for (const pending of info.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket closed'));
    }
    info.pending.clear();
    activeSockets.delete(socketKey);
    log(`[${target.name}] Đã đóng kết nối tới "${title}"; sẽ thử kết nối lại.`);
  };
  ws.onerror = () => {};
}

async function loop() {
  while (isRunning) {
    let anyOnline = false;
    for (const target of TARGET_CONFIGS) {
      const port = await getTargetPort(target);
      if (!port) continue;
      anyOnline = true;
      try {
        const response = await fetchWithTimeout(`http://127.0.0.1:${port}/json`, 1200);
        if (!response.ok) continue;
        const targets = await response.json();
        const pages = Array.isArray(targets) ? targets.filter(item =>
          ['page', 'webview', 'iframe'].includes(item.type) && item.id && item.webSocketDebuggerUrl
        ) : [];
        for (const page of pages) await connectToPage(target, page, port);
      } catch (error) {}
    }
    const now = Date.now();
    if (!anyOnline && activeSockets.size === 0 && now - lastWaitingLogTime > 15000) {
      lastWaitingLogTime = now;
      log('Đang chờ Antigravity (App hoặc IDE) khởi động...');
    }
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
}

function stopProcess() {
  isRunning = false;
  for (const info of activeSockets.values()) {
    try { info.ws.close(); } catch (error) {}
  }
  cleanPid();
  process.exit(0);
}

acquireSingleton();
process.on('SIGINT', () => { log('Đang dừng chương trình...'); stopProcess(); });
process.on('SIGTERM', stopProcess);
process.on('exit', cleanPid);

console.log('========================================================');
console.log('🛡️ ANTIGRAVITY AUTO-SUBMIT (SAFETY-FIRST DUAL-ENGINE)');
console.log(`Tiến trình PID: ${process.pid}`);
console.log('Chỉ tự duyệt lệnh mức thấp; trường hợp khác giữ lại cho người dùng.');
console.log(`Audit log: ${audit.logPath}`);
console.log('========================================================');
loop().catch(error => { log(`Lỗi vòng lặp chính: ${error.message}`); stopProcess(); });
