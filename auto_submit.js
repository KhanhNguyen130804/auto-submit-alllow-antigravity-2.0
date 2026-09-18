/**
 * Antigravity Auto-Submit Daemon (Dual-Engine)
 * Tự động phê duyệt và nhấn nút Submit / Allow mỗi khi Agent yêu cầu chạy lệnh terminal.
 * 
 * Hỗ trợ song song cả 2 nền tảng:
 * 1. Antigravity 2.0 (Standalone Desktop Electron App)
 * 2. Antigravity IDE 2.0 (AI-first IDE trên nền VS Code)
 * 
 * Hoạt động ngầm thông qua Chrome DevTools Protocol (CDP).
 * Không chiếm quyền chuột, không ảnh hưởng thao tác phím, phản hồi tức thì (< 20ms).
 */

const fs = require('fs');
const path = require('path');

const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');

// Cấu hình các ứng dụng Antigravity được giám sát
const TARGET_CONFIGS = [
  {
    id: 'desktop',
    name: 'Antigravity Desktop 2.0',
    portFile: path.join(APPDATA, 'Antigravity', 'DevToolsActivePort'),
    fallbackPort: null
  },
  {
    id: 'ide',
    name: 'Antigravity IDE 2.0',
    portFile: path.join(APPDATA, 'Antigravity IDE', 'DevToolsActivePort'),
    fallbackPort: 9223 // Cổng được cấu hình qua setup_ide.bat (argv.json)
  }
];

const CHECK_INTERVAL_MS = 3000;
const SUBMIT_COOLDOWN_MS = 1500;

// Lưu trữ các kết nối WebSocket: socketKey -> { ws, targetConfig, pageTitle, port }
let activeSockets = new Map();
let isRunning = true;
let lastWaitingLogTime = 0;

function log(msg) {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

// Đoạn script được tiêm trực tiếp vào giao diện DOM (hỗ trợ cả Iframe và Webview)
const INJECTED_SCRIPT = `
(() => {
  if (window.__autoSubmitAntigravityInstalled) return 'already_installed';
  window.__autoSubmitAntigravityInstalled = true;

  let lastSubmitTime = 0;
  const COOLDOWN = ${SUBMIT_COOLDOWN_MS};

  // Thu thập tất cả document có thể truy cập (bao gồm cả iframe/webview con của VS Code)
  function getAllDocuments(root = document) {
    const docs = [root];
    try {
      const iframes = root.querySelectorAll('iframe, frame');
      for (const frame of iframes) {
        try {
          const doc = frame.contentDocument || frame.contentWindow?.document;
          if (doc && !docs.includes(doc)) {
            docs.push(...getAllDocuments(doc));
          }
        } catch (e) {
          // Iframe cross-origin được CDP xử lý riêng qua Target.setAutoAttach
        }
      }
    } catch (e) {}
    return docs;
  }

  function triggerSubmit() {
    const now = Date.now();
    if (now - lastSubmitTime < COOLDOWN) return false;

    const docs = getAllDocuments();
    for (const doc of docs) {
      if (!doc || !doc.querySelectorAll) continue;

      const buttons = Array.from(doc.querySelectorAll('button'));
      if (!buttons.length) continue;

      // Tìm nút phê duyệt: Submit, Allow, Always Allow, Proceed, Run
      const submitBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text === 'Submit' || 
               text.startsWith('Submit') ||
               text === 'Allow' ||
               text === 'Allow Once' ||
               text === 'Always Allow' ||
               text === 'Proceed';
      });

      if (!submitBtn) continue;

      // Xác minh dấu hiệu của hộp thoại phê duyệt chạy lệnh
      const hasSkipButton = buttons.some(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text === 'Skip' || text === 'Deny' || text === 'Cancel';
      });

      const bodyText = (doc.body ? doc.body.innerText : '') || '';
      const isApprovalDialog = hasSkipButton || 
                               bodyText.includes('allow this time') || 
                               bodyText.includes('Allow checking') ||
                               bodyText.includes('tell the agent what to do instead') ||
                               bodyText.includes('Do you want to run') ||
                               bodyText.includes('requires your approval') ||
                               bodyText.includes('Allow checking environment tools') ||
                               bodyText.includes('permission to run');

      if (isApprovalDialog) {
        lastSubmitTime = now;
        const btnText = (submitBtn.innerText || submitBtn.textContent || '').trim();
        console.log('[AUTO_SUBMIT_TRIGGERED] Phát hiện hộp thoại yêu cầu chạy lệnh! Đang nhấn nút: "' + btnText + '"');
        
        submitBtn.click();
        return true;
      }
    }
    return false;
  }

  // Quét định kỳ mỗi 100ms
  setInterval(triggerSubmit, 100);

  // Quan sát DOM Mutation để phản hồi ngay khi hộp thoại vừa render
  const observer = new MutationObserver(() => {
    triggerSubmit();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  console.log('[AUTO_SUBMIT_READY] Bộ giám sát DOM đã sẵn sàng.');
  return 'installed';
})()
`;

// Lấy cổng DevTools cho từng ứng dụng
async function getTargetPort(target) {
  // 1. Kiểm tra qua tệp DevToolsActivePort
  if (fs.existsSync(target.portFile)) {
    try {
      const content = fs.readFileSync(target.portFile, 'utf8');
      const firstLine = content.split('\n')[0].trim();
      const port = parseInt(firstLine, 10);
      if (!isNaN(port) && port > 0) {
        return port;
      }
    } catch (e) {}
  }

  // 2. Nếu có fallbackPort, thăm dò HTTP xem cổng có online không
  if (target.fallbackPort) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      const res = await fetch(`http://127.0.0.1:${target.fallbackPort}/json/version`, {
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        return target.fallbackPort;
      }
    } catch (e) {}
  }

  return null;
}

// Kết nối tới một trang / webview cụ thể
async function connectToPage(target, page, port) {
  const socketKey = `${target.id}::${page.id}`;
  if (activeSockets.has(socketKey)) return;

  const title = page.title || 'Untitled';
  log(`[${target.name}] Đang kết nối tới cửa sổ: "${title}"...`);

  let ws;
  try {
    ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch (err) {
    log(`[${target.name}] Lỗi tạo kết nối WebSocket: ${err.message}`);
    return;
  }

  activeSockets.set(socketKey, { ws, target, title, port });

  ws.onopen = () => {
    log(`✅ [${target.name}] Kết nối thành công (Port ${port}). Đang cài đặt bộ theo dõi tự động...`);

    // Kích hoạt Runtime, Page và tự động đính kèm webview con
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
    
    // Tự động đính kèm vào các Webview / iframe con (quan trọng cho Antigravity IDE)
    ws.send(JSON.stringify({
      id: 3,
      method: 'Target.setAutoAttach',
      params: {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      }
    }));

    // Đăng ký tiêm script vào mọi tài liệu mới
    ws.send(JSON.stringify({
      id: 4,
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: INJECTED_SCRIPT
      }
    }));

    // Tiêm ngay vào trang hiện tại
    ws.send(JSON.stringify({
      id: 5,
      method: 'Runtime.evaluate',
      params: {
        expression: INJECTED_SCRIPT,
        returnByValue: true
      }
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Lắng nghe console log từ script đã tiêm
      if (data.method === 'Runtime.consoleAPICalled') {
        const args = data.params.args || [];
        const text = args.map(a => a.value || '').join(' ');

        if (text.includes('[AUTO_SUBMIT_TRIGGERED]')) {
          log(`⚡ [${target.name}] TỰ ĐỘNG PHÊ DUYỆT THÀNH CÔNG: Đã nhấn nút phê duyệt lệnh!`);
        } else if (text.includes('[AUTO_SUBMIT_READY]')) {
          log(`🟢 [${target.name}] Trình theo dõi tự động đã kích hoạt trên giao diện.`);
        }
      } else if (data.method === 'Target.attachedToTarget') {
        // Một webview con vừa được mở ra, tiêm script vào session con này
        const sessionId = data.params?.sessionId;
        if (sessionId) {
          ws.send(JSON.stringify({
            id: 100,
            sessionId,
            method: 'Runtime.evaluate',
            params: {
              expression: INJECTED_SCRIPT,
              returnByValue: true
            }
          }));
        }
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    activeSockets.delete(socketKey);
    log(`[${target.name}] Đã đóng kết nối tới cửa sổ "${title}". Sẽ tự động kết nối lại khi có thể.`);
  };

  ws.onerror = () => {
    activeSockets.delete(socketKey);
  };
}

// Vòng lặp giám sát đa mục tiêu
async function loop() {
  while (isRunning) {
    let anyOnline = false;

    for (const target of TARGET_CONFIGS) {
      const port = await getTargetPort(target);
      if (!port) continue;

      anyOnline = true;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`http://127.0.0.1:${port}/json`, {
          signal: controller.signal
        });
        clearTimeout(timer);

        const targets = await res.json();
        // Lấy tất cả các target hợp lệ (cửa sổ chính, webview, iframe)
        const pages = targets.filter(t => 
          (t.type === 'page' || t.type === 'webview' || t.type === 'iframe') && 
          t.webSocketDebuggerUrl
        );

        for (const page of pages) {
          const socketKey = `${target.id}::${page.id}`;
          if (!activeSockets.has(socketKey)) {
            await connectToPage(target, page, port);
          } else {
            // Duy trì tiêm lại script khi người dùng chuyển hội thoại (SPA navigation)
            const socketInfo = activeSockets.get(socketKey);
            if (socketInfo && socketInfo.ws && socketInfo.ws.readyState === WebSocket.OPEN) {
              socketInfo.ws.send(JSON.stringify({
                id: 99,
                method: 'Runtime.evaluate',
                params: {
                  expression: INJECTED_SCRIPT,
                  returnByValue: true
                }
              }));
            }
          }
        }
      } catch (err) {}
    }

    // Nếu chưa có ứng dụng nào mở, thông báo nhẹ định kỳ mỗi 15 giây
    const now = Date.now();
    if (!anyOnline && activeSockets.size === 0 && (now - lastWaitingLogTime > 15000)) {
      lastWaitingLogTime = now;
      log(`Đang chờ Antigravity (App hoặc IDE) khởi động...`);
    }

    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
  }
}

const PID_PATH = path.join(__dirname, 'auto_submit.pid');

function cleanPid() {
  try {
    if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
  } catch (e) {}
}

// Ghi PID tiến trình hiện tại
try {
  fs.writeFileSync(PID_PATH, process.pid.toString(), 'utf8');
} catch (e) {}

// Dọn dẹp an toàn khi dừng tiến trình
function stopProcess() {
  isRunning = false;
  cleanPid();
  for (const info of activeSockets.values()) {
    try { info.ws.close(); } catch (e) {}
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  log(`Đang dừng chương trình...`);
  stopProcess();
});

process.on('SIGTERM', () => {
  stopProcess();
});

process.on('exit', () => {
  cleanPid();
});

console.log('========================================================');
console.log('🚀 ANTIGRAVITY AUTO-SUBMIT SERVICE (DUAL-ENGINE)');
console.log(`Tiến trình PID: ${process.pid}`);
console.log('Hỗ trợ: Antigravity 2.0 (Desktop) + Antigravity IDE 2.0');
console.log('========================================================');

loop();
