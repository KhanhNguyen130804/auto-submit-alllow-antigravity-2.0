# 🚀 Antigravity Auto-Submit Daemon

Chương trình tự động hóa việc nhấn nút **`Submit`** để phê duyệt lệnh terminal trong Antigravity mỗi khi xuất hiện bảng thông báo xác nhận an toàn (`Allow checking environment tools?...`), giúp agent làm việc liên tục mà không cần người dùng phải bấm thủ công.

---

## 🌟 Tính Năng Nổi Bật (Phương Án 1 - Node.js CDP)

1. **Hoàn toàn không chiếm chuột**: 
   - Chương trình kích hoạt sự kiện `.click()` trực tiếp ở tầng DOM thông qua Chrome DevTools Protocol của Antigravity.
   - Con trỏ chuột của bạn hoàn toàn tự do, không bị giật, bạn có thể gõ phím hoặc làm việc khác mà không bị ảnh hưởng.
2. **Hoạt động ngầm (Background)**:
   - Tự động click ngay cả khi cửa sổ Antigravity bị che khuất hoặc thu nhỏ xuống Taskbar.
3. **Tốc độ phản ứng tức thì**:
   - Sử dụng `MutationObserver` kết hợp chu kỳ quét 100ms, tự động nhấn Submit trong vòng **dưới 20ms** kể từ khi bảng hiện lên.
4. **Không cần cài đặt thêm phần mềm/thư viện**:
   - Máy tính của bạn đã có sẵn **Node.js `v24.19.0`**. Chương trình sử dụng 100% native API (`fetch`, `WebSocket`, `fs`) không cần chạy `npm install`.
5. **Tự động kết nối lại (Auto-Reconnect)**:
   - Nếu bạn tắt Antigravity và mở lại, hoặc đổi cuộc hội thoại, chương trình sẽ tự động dò lại cổng và kết nối tiếp tục mà không cần khởi động lại tool.

---

## 📂 Danh Sách Tệp Trong Thư Mục

| Tệp | Mô tả |
| :--- | :--- |
| **`auto_submit.js`** | Mã nguồn chính của daemon Node.js |
| **`start_console.bat`** | Khởi động tool với cửa sổ Console (để theo dõi log trực tiếp) |
| **`start_silent.vbs`** | **[Khuyên dùng]** Khởi chạy tool ẩn hoàn toàn dưới nền (không hiện cửa sổ nào) |
| **`stop.bat`** | Dừng ngay lập tức dịch vụ auto-submit |
| **`setup_autostart.bat`** | Thêm tool vào thư mục Startup của Windows (tự chạy khi bật máy) |
| **`remove_autostart.bat`** | Hủy tự khởi động cùng Windows |
| **`auto_submit_visual.py`** | Script Python dự phòng (clicker màn hình theo hình ảnh, cần cài OpenCV) |

---

## 🚀 Hướng Dẫn Sử Dụng

### Cách 1: Chạy ẩn dưới nền (Khuyên dùng cho hàng ngày)
- **Nhấp đúp chuột vào tệp `start_silent.vbs`**.
- Chương trình sẽ lập tức chạy ngầm trong Windows. Bạn sẽ không thấy cửa sổ nào hiện lên làm phiền.
- Khi Antigravity hiển thị bảng hỏi phê duyệt lệnh, tool sẽ âm thầm nhấn `Submit` ngay lập tức!

### Cách 2: Chạy với cửa sổ Console (Để xem log chi tiết)
- **Nhấp đúp chuột vào tệp `start_console.bat`**.
- Cửa sổ màu đen sẽ hiện lên và thông báo:
  ```text
  [22:30:15] ✅ Đã kết nối thành công tới Antigravity (Port 59851).
  [22:30:15] 🟢 Trình theo dõi tự động đã kích hoạt trên giao diện.
  ...
  [22:35:10] ⚡ TỰ ĐỘNG PHÊ DUYỆT THÀNH CÔNG: Đã nhấn nút Submit cho lệnh của Antigravity!
  ```

### Cách dừng chương trình:
- **Nhấp đúp chuột vào tệp `stop.bat`** bất kỳ lúc nào bạn muốn tạm dừng tự động hóa.

### Cài đặt tự khởi động khi bật máy tính:
- **Nhấp đúp chuột vào tệp `setup_autostart.bat`**.
- Shortcut của tool sẽ được đặt vào thư mục `shell:startup` của Windows. Mỗi khi bạn bật máy, tool sẽ tự động chạy ngầm.
- Nếu không muốn tự khởi động nữa, chỉ cần nhấp đúp vào `remove_autostart.bat`.

---

## 🔄 Khi Chuyển Sang Đoạn Chat Khác Hoặc Dự Án Khác Thì Sao?

**Câu trả lời là: Bạn HOÀN TOÀN KHÔNG CẦN LÀM GÌ CẢ!**

Chương trình được thiết kế chạy ở cấp độ **Toàn bộ ứng dụng Antigravity**:
- Khi bạn nhấn `+ New Conversation` (tạo đoạn chat mới),
- Khi bạn mở lại đoạn chat cũ trong lịch sử (`Conversation History`),
- Khi bạn đổi workspace/project khác trên thanh sidebar,
- Hoặc thậm chí khi bạn tắt hẳn Antigravity và bật lại sau đó...

Cơ chế `Page.addScriptToEvaluateOnNewDocument` kết hợp vòng lặp tự động duy trì kết nối của `auto_submit.js` sẽ **tự động bám theo và kích hoạt trên bất kỳ đoạn chat nào** đang hiển thị. Bạn chỉ cần bật tool một lần duy nhất (hoặc cài đặt tự chạy cùng Windows), sau đó hoàn toàn yên tâm làm việc!

---

## 🛡️ Cơ Chế An Toàn & Tránh Bấm Nhầm
- Chương trình chỉ kích hoạt khi xác nhận có nút `Submit` nằm cạnh nút `Skip` hoặc khi trang có chứa nội dung hộp thoại phê duyệt lệnh (`allow this time`, `Allow checking`, `tell the agent what to do instead`).
- Các nút chức năng khác trên giao diện Antigravity (nút cài đặt `Settings`, nút chọn model, nút gửi chat, các nút trong thanh điều hướng) đều không bị ảnh hưởng.
- Có cơ chế **Cooldown (1.5 giây)** để đảm bảo không bị click đúp hay lặp lệnh liên tiếp.

---

## ⚠️ Lưu Ý An Toàn & Bảo Mật (Security Disclaimer)

- **Bản chất hoạt động**: Hộp thoại xác nhận của Antigravity là lớp bảo vệ nhằm ngăn AI agent tự ý chạy các lệnh terminal ngoài ý muốn hoặc có thể làm thay đổi hệ thống. Công cụ này sẽ tự động nhấn `Submit` để bypass hộp thoại xác nhận đó.
- **Khuyến nghị sử dụng**: Bạn chỉ nên bật công cụ này khi làm việc trên các dự án an toàn, môi trường phát triển (development/sandbox) đáng tin cậy hoặc khi bạn đã thiết lập kiểm soát phiên bản (Git).
- **Kiểm soát thủ công**: Nếu đang thực hiện các thao tác nhạy cảm (như migration dữ liệu, xoá file hàng loạt, thao tác production), hãy nhấp đúp vào `stop.bat` để dừng công cụ và quay về cơ chế phê duyệt thủ công.
