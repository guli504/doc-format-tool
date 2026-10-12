@echo off
chcp 936 >nul
title 文档格式整改工具 · 局域网共享
echo.
echo   ==================================================
echo    局域网共享：让同办公室的同事用浏览器访问本工具
echo   ==================================================
echo.
echo   运行期间请不要关闭本窗口；按 Ctrl+C 可停止共享。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0局域网共享.ps1"
echo.
pause
