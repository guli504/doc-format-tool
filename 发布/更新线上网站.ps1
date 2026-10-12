# 一键更新线上网站（新版：项目根目录本身就是 Git 仓库，直接推送即可）
#
# 用法：右键本文件 → 使用 PowerShell 运行
#       （或：VS Code 里 Ctrl+Shift+B → 选「推送线上」）
# 作用：把你在 VS Code 里改好的代码提交并推送到 GitHub，
#       约 1 分钟后线上网址自动更新。
# 线上网址：https://guli504.github.io/doc-format-tool/
#
# 说明：2026-10 起项目重构为「项目根目录 = Git 仓库」，
#       不再需要手动同步「网站版」文件夹（该文件夹已废弃并忽略）。

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot     # 项目根目录

if (-not (Test-Path (Join-Path $repo '.git'))) {
  Write-Host ''
  Write-Host '  [X] 项目根目录还不是 Git 仓库，无法推送。' -ForegroundColor Red
  Read-Host '  按回车退出'
  exit 1
}

Push-Location $repo
$remote = (git remote get-url origin 2>$null | Select-Object -First 1)
Write-Host ''
Write-Host "  远程仓库：$remote" -ForegroundColor Cyan

# 先拉最新，避免覆盖协作者的改动
git pull --rebase origin main 2>&1 | ForEach-Object { Write-Host "  $_" }

git add -A 2>&1 | Out-Null
$changed = (git status --porcelain 2>$null | Measure-Object).Count

if ($changed -eq 0) {
  Write-Host '  没有发现改动，无需推送。' -ForegroundColor Yellow
} else {
  git -c core.autocrlf=false commit -q -m "更新（$(Get-Date -Format 'yyyy-MM-dd HH:mm')）" 2>&1 | Out-Null
  Write-Host "  已提交 $changed 处改动，正在推送..." -ForegroundColor Cyan
  git push 2>&1 | ForEach-Object { Write-Host "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  [X] 推送失败。' -ForegroundColor Red
    Write-Host '      若提示未登录，先运行「一键推送到GitHub.ps1」登录一次即可。' -ForegroundColor Yellow
    Pop-Location
    Read-Host '  按回车退出'
    exit 1
  }
  Write-Host '  [√] 推送成功' -ForegroundColor Green
}
Pop-Location

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '   已更新，约 1 分钟后生效：' -ForegroundColor Green
Write-Host '   https://guli504.github.io/doc-format-tool/' -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host ''
try { Start-Process 'https://guli504.github.io/doc-format-tool/' } catch { }
Read-Host '  按回车退出'