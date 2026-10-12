# 一键更新线上网站（把「网站版」最新内容推送到 GitHub Pages）
#
# 作用：你改完代码 / 文档后，双击这个脚本，线上网址就会更新（约 1 分钟后生效）。
# 线上网址：https://guli504.github.io/doc-format-tool/
#
# 用法：右键本文件 → 使用 PowerShell 运行
#      （若报错“禁止运行脚本”，就在 PowerShell 里执行：
#        powershell -ExecutionPolicy Bypass -File "本文件完整路径" ）

# 注意：这里刻意用 Continue —— git 会把换行提示写到 stderr，
# 若用 Stop，PowerShell 会把正常提示当成错误而中断脚本。
$ErrorActionPreference = 'Continue'
$site = Join-Path $PSScriptRoot '网站版'

if (-not (Test-Path (Join-Path $site '.git'))) {
  Write-Host ''
  Write-Host '  [X] 「网站版」还不是 Git 仓库，说明从未推送过。' -ForegroundColor Red
  Write-Host '      请先运行同目录下的「一键推送到GitHub.ps1」完成首次发布。' -ForegroundColor Yellow
  Write-Host ''
  Read-Host '  按回车退出'
  exit 1
}

Push-Location $site
$remote = (git remote get-url origin 2>$null | Select-Object -First 1)
if (-not $remote) { $remote = '' }
Write-Host ''
Write-Host "  远程仓库：$remote" -ForegroundColor Cyan

git add -A 2>&1 | Out-Null
$changed = (git status --porcelain 2>$null | Measure-Object).Count

if ($changed -eq 0) {
  Write-Host '  没有发现改动，无需推送。' -ForegroundColor Yellow
} else {
  git -c core.autocrlf=false commit -q -m "更新站点内容（$(Get-Date -Format 'yyyy-MM-dd HH:mm')）" 2>&1 | Out-Null
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

# 从远程地址推断线上网址
$url = 'https://guli504.github.io/doc-format-tool/'
if ($remote -match 'github\.com[:/]([^/]+)/([^/.]+)') {
  $url = "https://$($Matches[1]).github.io/$($Matches[2])/"
}
Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '   已更新，约 1 分钟后生效：' -ForegroundColor Green
Write-Host "   $url" -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host ''
Start-Process $url
Read-Host '  按回车退出'
