# 🛡️ Antigravity Auto-Submit Daemon (Safety-First Dual-Engine)

Daemon Windows tự động phê duyệt **một tập lệnh đọc có rủi ro thấp** trong:

- Antigravity Desktop 2.0
- Antigravity IDE 2.0

Daemon điều khiển DOM qua Chrome DevTools Protocol (CDP), không chiếm chuột. Khác với phiên bản cũ, chương trình không còn nhấn `Submit`/`Allow` chỉ vì nhận ra hộp thoại phê duyệt.

## Cơ chế an toàn

```text
Phát hiện hộp thoại
        ↓
Trích xuất duy nhất một lệnh + working directory
        ↓
Policy engine phân loại rủi ro
        ↓
Chỉ mức LOW mới được xem xét tự duyệt
        ↓
Xác minh lại ID + hash + nội dung + trạng thái nút
        ↓
Click hoặc giữ nguyên để người dùng quyết định
```

Nguyên tắc là **fail-closed**: khi thiếu thông tin, không phân tích chắc chắn được hoặc nội dung thay đổi trước lúc click, daemon sẽ không nhấn gì.

### Lệnh có thể được tự duyệt

Allowlist được hardcode trong `command_policy.js` và chỉ gồm các dạng giới hạn:

| Nhóm | Ví dụ |
| --- | --- |
| Vị trí hiện tại | `pwd`, `Get-Location` |
| Trạng thái Git | `git status --short` |
| Đọc lịch sử/diff Git | `git log --oneline -5`, `git diff --stat`, `git show HEAD` |
| Liệt kê thư mục | `dir /b`, `Get-ChildItem -Force`, `ls` |
| Tìm kiếm văn bản/tệp | `rg TODO src`, `rg --files` |
| Kiểm tra cú pháp Node | `node --check file.js` |

Ngay cả các lệnh trên cũng không được tự duyệt nếu chứa đường dẫn tuyệt đối, `..`, biến shell, tệp nhạy cảm hoặc cú pháp ghép lệnh.

### Trường hợp luôn yêu cầu duyệt thủ công

- Không đọc được chính xác một lệnh hoặc không có working directory tuyệt đối.
- Pipe, redirect, `&&`, `||`, `;`, command substitution, biến môi trường hoặc cú pháp shell phức tạp.
- Đường dẫn tuyệt đối, thư mục cha, `.env`, `.ssh`, credentials, token, password và các tệp bí mật khác.
- Chạy script, test, build, package manager, network request hoặc chương trình ngoài allowlist.
- Xóa/ghi đè dữ liệu, thay đổi Git có thể mất dữ liệu, quản lý process/service/user/registry/firewall, nâng quyền, shutdown, format ổ đĩa hoặc mã hóa/làm rối câu lệnh.

Lệnh không được tự duyệt vẫn nằm nguyên trên giao diện để người dùng chọn `Allow` hoặc `Deny`. Daemon không tự nhấn `Deny`.

> “Read-only” chỉ giảm rủi ro thay đổi máy, không đảm bảo dữ liệu đọc ra không nhạy cảm. Hãy kiểm tra thủ công khi làm việc với repository chứa bí mật hoặc dữ liệu production.

## Kiến trúc

- `auto_submit.js`: kết nối CDP, điều phối quyết định và quản lý vòng đời daemon.
- `dom_monitor.js`: phát hiện hộp thoại, trích xuất lệnh/CWD và xác minh lại trước click.
- `command_policy.js`: policy engine thuần, không có quyền click.
- `audit_logger.js`: audit log đã che dữ liệu nhạy cảm và xoay vòng.
- `process_utils.js`: xác minh PID/command line để tránh chạy trùng hoặc dừng nhầm tiến trình.
- `test/`: kiểm thử bằng `node:test`, không cần cài package.

Chỉ có một vị trí gọi `.click()` trong toàn bộ mã nguồn: bên trong hàm xác minh của `dom_monitor.js`. Policy engine chạy ở Node.js; script trong trang không tự quyết định lệnh nào an toàn.

## Thiết lập Antigravity IDE

1. Nhấp đúp `setup_ide.bat` để thêm `"remote-debugging-port": "9223"` vào `~/.antigravity-ide/argv.json`.
2. Tắt hoàn toàn và mở lại Antigravity IDE.
3. Chạy daemon bằng một trong các cách bên dưới.

Antigravity Desktop được dò qua `DevToolsActivePort`. IDE ưu tiên `DevToolsActivePort` và dùng cổng `9223` làm fallback. Daemon chỉ chấp nhận WebSocket CDP từ loopback và đúng cổng đã phát hiện.

## Sử dụng

### Chạy có console

Nhấp đúp `start_console.bat`. Console hiển thị lệnh nào được tự duyệt và lệnh nào đang chờ người dùng.

### Chạy ẩn

Nhấp đúp `start_silent.vbs`. Daemon chạy nền và vẫn ghi audit log.

### Dừng

Nhấp đúp `stop.bat`. Script xác minh PID cùng command line trước khi dừng và không quét/tắt các tiến trình Node khác.

### Tự khởi động cùng Windows

- `setup_autostart.bat`: tạo shortcut trong thư mục Startup.
- `remove_autostart.bat`: gỡ shortcut đó.

Daemon dùng PID lock để không chạy nhiều instance đồng thời.

## Audit log

Quyết định được ghi vào `security-audit.log` dưới dạng JSON Lines với các trường thời gian, ứng dụng, trang, mức rủi ro, hành động, rule, lý do và lệnh đã che bí mật.

- Token, password, API key, credential trong URL và header authorization được thay bằng `[REDACTED]`.
- Mỗi log tối đa khoảng 1 MB.
- Giữ tối đa 5 bản sao xoay vòng: `.1` đến `.5`.
- Các file `.log` đã nằm trong `.gitignore`.

Audit log hỗ trợ điều tra nhưng không nên được xem là nơi lưu bí mật. Bộ che dữ liệu không thể nhận biết mọi định dạng bí mật tùy biến.

## Kiểm thử

Yêu cầu Node.js có `node:test` (khuyến nghị Node 20 trở lên):

```powershell
node --test
```

Bộ test kiểm tra allowlist, nhóm lệnh nguy hiểm, đường dẫn/tệp nhạy cảm, redaction, log rotation và việc hủy click khi hộp thoại thay đổi.

## Phương án visual dự phòng

`auto_submit_visual.py` đã được vô hiệu hóa vì nhận diện hình ảnh không thể cung cấp đủ command/CWD cho policy engine. Tệp được giữ lại chỉ để giải thích rõ cho các shortcut hoặc tài liệu cũ; nó không còn thực hiện click.
