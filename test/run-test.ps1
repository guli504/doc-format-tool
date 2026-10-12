# Headless Edge test runner for test/engine-test.html (ASCII only: Windows PowerShell reads .ps1 as ANSI)
param(
  [string]$Page = 'engine-test.html',
  [int]$Budget = 180000
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
$root = Split-Path -Parent $PSScriptRoot
$url = 'file:///' + ($root -replace '\\', '/' -replace ' ', '%20') + '/test/' + $Page
$tmp = Join-Path $env:TEMP ('dft-edge-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$outFile = Join-Path $env:TEMP 'dft-test-out.html'
$errFile = Join-Path $env:TEMP 'dft-test-err.txt'
$edgeArgs = @('--headless', '--disable-gpu', '--no-first-run', "--user-data-dir=$tmp",
          '--allow-file-access-from-files', "--virtual-time-budget=$Budget", '--dump-dom', $url)
$p = Start-Process -FilePath $edge -ArgumentList $edgeArgs -RedirectStandardOutput $outFile -RedirectStandardError $errFile -NoNewWindow -PassThru -Wait
$html = Get-Content $outFile -Raw -Encoding UTF8
$i = $html.IndexOf('<pre id="out">')
if ($i -ge 0) {
  $j = $html.IndexOf('</pre>', $i)
  $txt = $html.Substring($i + 14, $j - $i - 14)
  [System.Web.HttpUtility]::HtmlDecode($txt)
} else {
  Write-Output 'NO TEST OUTPUT; raw DOM head:'
  $html.Substring(0, [Math]::Min(2000, $html.Length))
}
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
