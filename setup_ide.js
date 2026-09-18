/**
 * Script cấu hình tự động Antigravity IDE 2.0
 * Kích hoạt cổng Chrome DevTools Protocol (CDP) thông qua ~/.antigravity-ide/argv.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const IDE_PORT = '9223';
const ARG_KEY = 'remote-debugging-port';

const userHome = os.homedir();
const ideDir = path.join(userHome, '.antigravity-ide');
const argvPath = path.join(ideDir, 'argv.json');

console.log('========================================================');
console.log('🔧 CẤU HÌNH ANTIGRAVITY IDE 2.0 CHO AUTO-SUBMIT');
console.log('========================================================\n');

try {
  if (!fs.existsSync(ideDir)) {
    fs.mkdirSync(ideDir, { recursive: true });
    console.log(`📁 Đã tạo thư mục cấu hình: ${ideDir}`);
  }

  let content = '';
  if (fs.existsSync(argvPath)) {
    content = fs.readFileSync(argvPath, 'utf8');
  } else {
    content = '{\n}\n';
  }

  // Kiểm tra xem đã có cấu hình remote-debugging-port chưa
  const portRegex = /"remote-debugging-port"\s*:\s*["']?(\d+)["']?/;
  const match = content.match(portRegex);

  if (match) {
    console.log(`ℹ️ Cổng gỡ lỗi đã được thiết lập từ trước: Port ${match[1]}`);
    if (match[1] !== IDE_PORT) {
      console.log(`🔄 Cập nhật cổng sang ${IDE_PORT}...`);
      content = content.replace(portRegex, `"remote-debugging-port": "${IDE_PORT}"`);
      fs.writeFileSync(argvPath, content, 'utf8');
    }
  } else {
    // Thêm cờ vào trước dấu ngoặc đóng cuối cùng của JSON
    const lastBraceIndex = content.lastIndexOf('}');
    if (lastBraceIndex !== -1) {
      const before = content.slice(0, lastBraceIndex).trimEnd();
      const needsComma = before.length > 0 && !before.endsWith('{') && !before.endsWith(',');
      const insertText = (needsComma ? ',\n' : '\n') +
        `\t// Bật cổng DevTools Protocol để Auto-Submit Daemon tương tác tự động\n` +
        `\t"${ARG_KEY}": "${IDE_PORT}"\n`;
      const after = content.slice(lastBraceIndex);
      content = before + insertText + after;
      fs.writeFileSync(argvPath, content, 'utf8');
    } else {
      // Tệp không hợp lệ, tạo mới
      const newConfig = {
        [ARG_KEY]: IDE_PORT
      };
      fs.writeFileSync(argvPath, JSON.stringify(newConfig, null, 2), 'utf8');
    }
    console.log(`✅ Đã thêm thành công: "${ARG_KEY}": "${IDE_PORT}" vào:`);
    console.log(`   ${argvPath}`);
  }

  console.log('\n--------------------------------------------------------');
  console.log('🎉 CẤU HÌNH HOÀN TẤT!');
  console.log('👉 LƯU Ý QUAN TRỌNG:');
  console.log('   Nếu Antigravity IDE đang mở, vui lòng TẮT ĐI VÀ MỞ LẠI');
  console.log('   để IDE nhận cổng DevTools mới.');
  console.log('--------------------------------------------------------\n');
} catch (err) {
  console.error('❌ [LỖI] Không thể cấu hình tệp argv.json:', err.message);
  process.exit(1);
}
