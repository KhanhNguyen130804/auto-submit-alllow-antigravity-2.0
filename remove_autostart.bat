@echo off
chcp 65001 >nul
cd /d "%~dp0"
node remove_autostart.js
echo.
pause
