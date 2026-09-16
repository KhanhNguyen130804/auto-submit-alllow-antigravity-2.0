const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const shortcutPath = path.join(startupDir, 'AntigravityAutoSubmit.lnk');
const targetScript = path.join(__dirname, 'start_silent.vbs');

console.log('Đang cấu hình tự khởi động cùng Windows...');

const psScript = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}')
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"${targetScript.replace(/\\/g, '\\\\')}"'
$s.WorkingDirectory = '${__dirname.replace(/\\/g, '\\\\')}'
$s.Description = 'Antigravity Auto-Submit Daemon'
$s.Save()
`;

try {
  const base64Script = Buffer.from(psScript, 'utf16le').toString('base64');
  execSync(`powershell -NoProfile -EncodedCommand ${base64Script}`);
  if (fs.existsSync(shortcutPath)) {
    console.log('[THÀNH CÔNG] Đã tạo shortcut trong thư mục Startup:');
    console.log(shortcutPath);
    console.log('\nTừ nay, dịch vụ sẽ tự động chạy ngầm mỗi khi bạn bật máy tính!');
  } else {
    console.log('[LỖI] Không tìm thấy shortcut sau khi tạo.');
  }
} catch (err) {
  console.error('[LỖI]', err.message);
}
