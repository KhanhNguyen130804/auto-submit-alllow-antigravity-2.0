@echo off
chcp 65001 >nul
title Antigravity Auto-Submit (Console)
cd /d "%~dp0"

echo ========================================================
echo   🚀 KHỞI ĐỘNG ANTIGRAVITY AUTO-SUBMIT (CONSOLE MODE)
echo   Chương trình tự động phê duyệt và nhấn Submit trong Antigravity
echo ========================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [LỖI] Không tìm thấy Node.js trên hệ thống!
    echo Vui lòng cài đặt Node.js từ https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo Đang chạy dịch vụ giám sát... (Nhấn Ctrl+C để dừng)
echo.
node auto_submit.js

echo.
echo Dịch vụ đã dừng.
pause
