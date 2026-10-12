@echo off
chcp 936 >nul
title 文档格式整改工具
echo.
echo   ============================================
echo      文档格式批量整改工具 （双击即用 · 离线版）
echo   ============================================
echo.
echo   正在用默认浏览器打开工具...
echo.
for %%f in ("%~dp0*.html") do (
    start "" "%%~ff"
    goto opened
)
echo   [X] 没找到工具文件（*.html）。
echo       请确认“启动工具.bat”和“文档格式整改工具.html”在同一个文件夹里。
echo.
pause
exit /b 1
:opened
rem 打开成功后自动关闭本窗口
exit /b 0
