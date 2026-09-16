const path = require('path');
const fs = require('fs');

const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const shortcutPath = path.join(startupDir, 'AntigravityAutoSubmit.lnk');

if (fs.existsSync(shortcutPath)) {
  try {
    fs.unlinkSync(shortcutPath);
    console.log('[THÀNH CÔNG] Đã hủy tự khởi động cùng Windows.');
  } catch (err) {
    console.error('[LỖI]', err.message);
  }
} else {
  console.log('[THÔNG BÁO] Dịch vụ hiện chưa được cài đặt tự khởi động cùng Windows.');
}
