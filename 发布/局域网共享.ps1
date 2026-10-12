# =============================================================================
#  局域网共享服务器（无需安装任何软件、无需管理员权限）
#  作用：把本文件夹里的工具页面通过本机网络分享出去，
#        同事在同一局域网（同一个 WiFi / 网线）里用浏览器就能打开使用。
#  用法：双击“局域网共享.bat”，或在本目录执行：
#        powershell -ExecutionPolicy Bypass -File .\局域网共享.ps1 -Port 8899
#  停止：在本窗口按 Ctrl+C
# =============================================================================
param(
  [int]$Port = 8899
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# 默认首页：本目录下的第一个 html 文件
$defaultFile = (Get-ChildItem -Path $root -Filter *.html | Select-Object -First 1)
if (-not $defaultFile) {
  Write-Host '  [X] 本文件夹里没有找到 .html 工具文件。' -ForegroundColor Red
  exit 1
}
$defaultPath = $defaultFile.FullName

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
try {
  $listener.Start()
} catch {
  Write-Host "  [X] 端口 $Port 被占用，请换一个端口，例如：.\局域网共享.ps1 -Port 8900" -ForegroundColor Red
  exit 1
}

function Get-LanIPs {
  try {
    return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -ExpandProperty IPAddress -Unique)
  } catch {
    return @()
  }
}

$ips = Get-LanIPs
Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '   工具已启动，把下面的网址发给同事即可（需在同一个局域网）' -ForegroundColor Cyan
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''
if ($ips.Count -gt 0) {
  foreach ($ip in $ips) {
    Write-Host ('     http://' + $ip + ':' + $Port + '/') -ForegroundColor Green
  }
} else {
  Write-Host '     （未检测到局域网 IP，请用 ipconfig 查看本机 IPv4 地址）' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  说明：'
Write-Host '    · 同事的浏览器打开上面网址即可使用，文件仍在他自己的电脑上处理；'
Write-Host '    · 若弹出“Windows 安全中心”防火墙提示，请勾选“专用网络”并允许访问；'
Write-Host '    · 本窗口关闭或按 Ctrl+C，共享即停止。'
Write-Host ''

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

$rootFull = [System.IO.Path]::GetFullPath($root)

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000
    $buffer = New-Object byte[] 16384
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { $client.Close(); continue }

    $header = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    $firstLine = ($header -split "`r`n")[0]
    $parts = $firstLine -split ' '
    $rawPath = if ($parts.Count -ge 2) { $parts[1] } else { '/' }
    $rawPath = $rawPath.Split('?')[0]
    $decoded = [System.Uri]::UnescapeDataString($rawPath)

    if ($decoded -eq '/' -or $decoded -eq '') {
      $target = $defaultPath
    } else {
      $rel = $decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $target = Join-Path $root $rel
    }

    $status = '200 OK'
    $body = $null
    $ctype = 'application/octet-stream'
    try {
      $full = [System.IO.Path]::GetFullPath($target)
      if ($full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $body = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
      } else {
        $status = '404 Not Found'
      }
    } catch {
      $status = '404 Not Found'
    }

    if ($null -eq $body) {
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $ctype = 'text/plain; charset=utf-8'
    }

    $head = "HTTP/1.1 $status`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($headBytes, 0, $headBytes.Length)
    if ($firstLine -notmatch '^HEAD') {
      $stream.Write($body, 0, $body.Length)
    }
    $stream.Flush()
    Write-Host ("  [{0}] {1}  {2}" -f (Get-Date -Format 'HH:mm:ss'), $status, $rawPath) -ForegroundColor DarkGray
  } catch {
    # 单个请求出错不影响服务器继续运行
  } finally {
    if ($client) { try { $client.Close() } catch { } }
  }
}
