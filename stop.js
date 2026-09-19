const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isExpectedDaemon, parsePidRecord } = require('./process_utils');

console.log('Đang dừng dịch vụ Antigravity Auto-Submit...');

const pidPath = path.join(__dirname, 'auto_submit.pid');
const expectedScript = path.join(__dirname, 'auto_submit.js');

try {
  if (fs.existsSync(pidPath)) {
    const record = parsePidRecord(fs.readFileSync(pidPath, 'utf8'));
    if (record && isExpectedDaemon(record.pid, record.scriptPath || expectedScript)) {
      try {
        process.kill(record.pid);
        console.log(`[OK] Đã dừng đúng tiến trình Auto-Submit PID: ${record.pid}`);
      } catch (e) {
        try {
          execSync(`taskkill /F /PID ${record.pid}`, { stdio: 'ignore' });
          console.log(`[OK] Đã tắt đúng tiến trình Auto-Submit PID: ${record.pid}`);
        } catch (_) {}
      }
    } else if (record) {
      console.log(`[AN TOÀN] PID ${record.pid} không thuộc Auto-Submit; không dừng tiến trình này.`);
    } else {
      console.log('[THÔNG BÁO] PID file không hợp lệ; không dừng tiến trình nào.');
    }
    fs.unlinkSync(pidPath);
  } else {
    console.log('[THÔNG BÁO] Không tìm thấy PID file; dịch vụ có thể chưa chạy.');
  }
} catch (e) {
  console.error('[LỖI]', e.message);
}

console.log('[HOÀN TẤT] Dịch vụ Antigravity Auto-Submit đã dừng.');
