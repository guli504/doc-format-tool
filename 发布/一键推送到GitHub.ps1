# =============================================================================
#  一键把「网站版」推送到 GitHub（推完再开一下 Pages，别人就能用网址访问了）
#  首次推送时会弹出浏览器让你登录 GitHub，登录一次以后就不用再登了。
#  用法：右键本文件 → 使用 PowerShell 运行；或在当前目录执行：
#        powershell -ExecutionPolicy Bypass -File .\一键推送到GitHub.ps1
# =============================================================================
$ErrorActionPreference = 'Stop'

$repoDir = Join-Path $PSScriptRoot '网站版'
if (-not (Test-Path $repoDir)) {
  Write-Host '  [X] 没找到「网站版」文件夹，请确认本脚本和它在一起。' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '  ================ 推送到 GitHub ================' -ForegroundColor Cyan
Write-Host '  提示：如果还没有仓库，脚本会先帮你打开“新建仓库”页面。' -ForegroundColor Gray
Write-Host ''

$user = Read-Host '  1) 请输入你的 GitHub 用户名（例如 guli504）'
if ([string]::IsNullOrWhiteSpace($user)) { Write-Host '  [X] 用户名不能为空' -ForegroundColor Red; exit 1 }
$user = $user.Trim()

$repo = Read-Host '  2) 请输入仓库名（直接回车 = doc-format-tool）'
if ([string]::IsNullOrWhiteSpace($repo)) { $repo = 'doc-format-tool' }
$repo = $repo.Trim()

$remote = "https://github.com/$user/$repo.git"
Write-Host ''
Write-Host "  即将推送到：$remote" -ForegroundColor Yellow
$ok = Read-Host '  确认继续？(直接回车 = 是，输入 n 取消)'
if ($ok -eq 'n') { exit 0 }

Push-Location $repoDir
try {
  if (-not (Test-Path (Join-Path $repoDir '.git'))) {
    git init -q
    git branch -M main
  }
  # 没配置过 Git 身份时，用仓库级身份兜底（不改动全局配置）
  $gitName = git config user.name
  if ([string]::IsNullOrWhiteSpace($gitName)) {
    git config user.name 'DocFormatTool'
    git config user.email 'docformat@local'
    Write-Host '  提示：已为本仓库设置默认提交身份 DocFormatTool（不影响全局配置）' -ForegroundColor Gray
  }
  git add -A 2>$null
  git -c core.autocrlf=false commit -q -m "更新：文档格式批量整改工具" 2>$null
  git remote remove origin 2>$null
  git remote add origin $remote
  Write-Host ''
  Write-Host '  正在推送（首次会弹出浏览器要求登录 GitHub）...' -ForegroundColor Cyan
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw "推送失败（退出码 $LASTEXITCODE）" }
} catch {
  Write-Host ''
  Write-Host '  [X] 推送失败：' -ForegroundColor Red
  Write-Host ('      ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host ''
  Write-Host '  常见原因与处理：' -ForegroundColor Yellow
  Write-Host '   1) 仓库还不存在 → 已为你打开新建页面，创建时不要勾选 README，然后重新运行本脚本。'
  Write-Host '   2) 登录弹窗被拦截 → 手动执行 git push 时会再次弹窗。'
  Write-Host '   3) 用户名/仓库名拼写错误 → 重新运行本脚本。'
  Start-Process 'https://github.com/new'
  Pop-Location
  Read-Host '  按回车退出'
  exit 1
}
Pop-Location

Write-Host ''
Write-Host '  ============ 推送成功！最后一步：开启 Pages ============' -ForegroundColor Green
Write-Host ''
Write-Host "   1) 浏览器打开： https://github.com/$user/$repo/settings/pages"
Write-Host '   2) Source 选择： Deploy from a branch'
Write-Host '   3) Branch 选择： main   /   (root)   然后点 Save'
Write-Host '   4) 等 1~2 分钟，别人就能用这个网址访问了：'
Write-Host ''
Write-Host "        https://$user.github.io/$repo/" -ForegroundColor Green
Write-Host ''
Start-Process "https://github.com/$user/$repo/settings/pages"
Start-Process "https://github.com/$user/$repo"
Read-Host '  按回车退出'
