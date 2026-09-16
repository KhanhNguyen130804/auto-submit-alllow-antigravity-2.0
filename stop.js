const fs = require('fs');
const { execSync } = require('child_process');

console.log('Đang dừng dịch vụ Antigravity Auto-Submit...');

try {
  if (fs.existsSync('auto_submit.pid')) {
    const pid = fs.readFileSync('auto_submit.pid', 'utf8').trim();
    if (pid) {
      try {
        process.kill(parseInt(pid, 10));
        console.log(`[OK] Đã dừng tiến trình PID: ${pid}`);
      } catch (e) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          console.log(`[OK] Đã tắt tiến trình PID: ${pid}`);
        } catch (_) {}
      }
    }
    fs.unlinkSync('auto_submit.pid');
  }
} catch (e) {}

try {
  execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*auto_submit.js*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', { stdio: 'ignore' });
} catch (e) {}

console.log('[HOÀN TẤT] Dịch vụ Antigravity Auto-Submit đã dừng.');
