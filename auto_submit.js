/**
 * Antigravity Auto-Submit Daemon
 * Tự động phê duyệt và nhấn nút Submit mỗi khi Antigravity yêu cầu cho phép chạy lệnh.
 * 
 * Hoạt động ngầm thông qua Chrome DevTools Protocol (CDP) trên Antigravity.
 * Không chiếm quyền chuột, không ảnh hưởng thao tác phím, phản hồi tức thì (< 20ms).
 */

const fs = require('fs');
const path = require('path');

const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
const DEVTOOLS_PATH = path.join(APPDATA, 'Antigravity', 'DevToolsActivePort');

const CHECK_INTERVAL_MS = 3000;
const SUBMIT_COOLDOWN_MS = 1500;

let activeSockets = new Map(); // targetId -> WebSocket
let isRunning = true;

function log(msg) {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

// Đoạn script được tiêm trực tiếp vào giao diện DOM của Antigravity
const INJECTED_SCRIPT = `
(() => {
  if (window.__autoSubmitAntigravityInstalled) return 'already_installed';
  window.__autoSubmitAntigravityInstalled = true;

  let lastSubmitTime = 0;
  const COOLDOWN = ${SUBMIT_COOLDOWN_MS};

  function triggerSubmit() {
    const now = Date.now();
    if (now - lastSubmitTime < COOLDOWN) return false;

    // Tìm tất cả các nút trên giao diện
    const buttons = Array.from(document.querySelectorAll('button'));
    
    // Tìm nút có nhãn Submit
    const submitBtn = buttons.find(b => {
      const text = (b.innerText || b.textContent || '').trim();
      return text === 'Submit' || text.startsWith('Submit');
    });

    if (!submitBtn) return false;

    // Kiểm tra xem hộp thoại xác nhận có đang hiển thị không:
    // Hộp thoại này có chứa các cụm từ đặc trưng như:
    // - "allow this time"
    // - "tell the agent what to do instead"
    // - Có nút "Skip" bên cạnh nút "Submit"
    const hasSkipButton = buttons.some(b => (b.innerText || b.textContent || '').trim() === 'Skip');
    const bodyText = document.body ? document.body.innerText : '';
    const isApprovalDialog = hasSkipButton || 
                             bodyText.includes('allow this time') || 
                             bodyText.includes('Allow checking') ||
                             bodyText.includes('tell the agent what to do instead');

    if (isApprovalDialog) {
      lastSubmitTime = now;
      console.log('[AUTO_SUBMIT_TRIGGERED] Phát hiện hộp thoại yêu cầu chạy lệnh! Đang nhấn Submit...');
      
      // Kích hoạt sự kiện click
      submitBtn.click();
      return true;
    }
    return false;
  }

  // Quét định kỳ cực nhanh mỗi 100ms
  setInterval(triggerSubmit, 100);

  // Quan sát DOM Mutation để phản hồi ngay lập tức khi hộp thoại render
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

async function getDevToolsPort() {
  if (!fs.existsSync(DEVTOOLS_PATH)) {
    return null;
  }
  try {
    const content = fs.readFileSync(DEVTOOLS_PATH, 'utf8');
    const firstLine = content.split('\n')[0].trim();
    const port = parseInt(firstLine, 10);
    return isNaN(port) ? null : port;
  } catch (e) {
    return null;
  }
}

async function connectToPage(page, port) {
  if (activeSockets.has(page.id)) return;

  log(`Đang kết nối tới cửa sổ Antigravity: "${page.title || 'Untitled'}"...`);

  let ws;
  try {
    ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch (err) {
    log(`Lỗi tạo kết nối WebSocket: ${err.message}`);
    return;
  }

  activeSockets.set(page.id, ws);

  ws.onopen = () => {
    log(`✅ Đã kết nối thành công tới Antigravity (Port ${port}). Đang cài đặt bộ theo dõi tự động...`);

    // Bật Domain Runtime và Page
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));

    // Đăng ký script tự động tiêm vào MỌI tài liệu mới, trang mới hoặc khi chuyển chat
    ws.send(JSON.stringify({
      id: 3,
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: INJECTED_SCRIPT
      }
    }));

    // Tiêm ngay vào trang hiện tại
    ws.send(JSON.stringify({
      id: 4,
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
          log(`⚡ TỰ ĐỘNG PHÊ DUYỆT THÀNH CÔNG: Đã nhấn nút Submit cho lệnh của Antigravity!`);
        } else if (text.includes('[AUTO_SUBMIT_READY]')) {
          log(`🟢 Trình theo dõi tự động đã kích hoạt trên giao diện.`);
        }
      }
    } catch (e) {
      // Bỏ qua lỗi parse
    }
  };

  ws.onclose = () => {
    activeSockets.delete(page.id);
    log(`Mất kết nối tới cửa sổ "${page.title}". Sẽ tự động kết nối lại khi có thể.`);
  };

  ws.onerror = (err) => {
    activeSockets.delete(page.id);
  };
}

async function loop() {
  while (isRunning) {
    const port = await getDevToolsPort();
    if (!port) {
      if (activeSockets.size === 0) {
        log(`Đang chờ Antigravity khởi động... (chưa thấy tệp DevToolsActivePort)`);
      }
    } else {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const targets = await res.json();
        
        // Lấy tất cả các targets thuộc loại 'page'
        const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);

        for (const page of pages) {
          if (!activeSockets.has(page.id)) {
            await connectToPage(page, port);
          } else {
            // Đảm bảo script theo dõi luôn hiện diện khi chuyển đổi giữa các đoạn chat (SPA / Navigation)
            const ws = activeSockets.get(page.id);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
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
      } catch (err) {
        // Port có thể chưa sẵn sàng hoặc Antigravity đang khởi động lại
      }
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

// Ghi PID hiện tại
try {
  fs.writeFileSync(PID_PATH, process.pid.toString(), 'utf8');
} catch (e) {}

// Xử lý dừng tiến trình nhẹ nhàng
process.on('SIGINT', () => {
  log(`Đang dừng chương trình...`);
  isRunning = false;
  cleanPid();
  for (const ws of activeSockets.values()) {
    try { ws.close(); } catch (e) {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  isRunning = false;
  cleanPid();
  for (const ws of activeSockets.values()) {
    try { ws.close(); } catch (e) {}
  }
  process.exit(0);
});

process.on('exit', () => {
  cleanPid();
});

console.log('====================================================');
console.log('🚀 ANTIGRAVITY AUTO-SUBMIT SERVICE');
console.log(`Tiến trình PID: ${process.pid}`);
console.log('Chương trình tự động nhấn nút Submit phê duyệt lệnh');
console.log('====================================================');

loop();

