@echo off
title 重新打包 - 文档格式整改工具
echo ============================================
echo   正在重新打包 发布\文档格式整改工具.html
echo ============================================
echo.

cd /d "%~dp0.."

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Users\21475\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE=C:\Users\21475\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo [错误] 找不到 node，请先安装 Node.js
    pause
    exit /b 1
  )
)

"%NODE%" build\build-single.js
if errorlevel 1 (
  echo.
  echo [失败] 打包出错，请检查上面的报错信息。
) else (
  echo.
  echo ============================================
  echo   打包完成！成品：发布\文档格式整改工具.html
  echo   现在可以双击它直接使用，或运行 启动工具.bat
  echo ============================================
)
echo.
pause
