@echo off
chcp 65001 >nul
cd /d "%~dp0"
node stop.js
ping 127.0.0.1 -n 2 >nul
