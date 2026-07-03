param(
  [int]$Port = 3000,
  [string]$Protocol = "http2"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TokenPath = Join-Path $ProjectRoot "cloudflared-token.txt"
$Cloudflared = Join-Path $ProjectRoot "tools\cloudflared2.exe"
if (-not (Test-Path $Cloudflared)) {
  $Cloudflared = Join-Path $ProjectRoot "tools\cloudflared.exe"
}
if (-not (Test-Path $Cloudflared)) {
  throw "cloudflared executable not found under tools"
}
if (-not (Test-Path $TokenPath)) {
  throw "cloudflared-token.txt not found"
}

Get-Process |
  Where-Object { $_.ProcessName -like "*cloudflared*" -or $_.Path -like "*cloudflared*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 2

$Token = (Get-Content $TokenPath -Raw).Trim()
if (-not $Token) {
  throw "cloudflared-token.txt is empty"
}

$ErrLog = Join-Path $ProjectRoot "cloudflared.err.log"
$OutLog = Join-Path $ProjectRoot "cloudflared.log"
if (Test-Path $ErrLog) {
  $Archive = Join-Path $ProjectRoot ("cloudflared.err." + (Get-Date).ToString("yyyyMMdd-HHmmss") + ".log")
  Move-Item $ErrLog $Archive -Force
}

Start-Process `
  -FilePath $Cloudflared `
  -ArgumentList @(
    "tunnel",
    "--protocol", $Protocol,
    "--edge-ip-version", "4",
    "--url", "http://127.0.0.1:$Port",
    "--no-autoupdate",
    "run",
    "--token", $Token
  ) `
  -WorkingDirectory $ProjectRoot `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -WindowStyle Hidden

Start-Sleep -Seconds 8

Write-Host "cloudflared restarted with protocol=$Protocol, edge-ip-version=4"
Get-Process |
  Where-Object { $_.ProcessName -like "*cloudflared*" -or $_.Path -like "*cloudflared*" } |
  Select-Object Id, ProcessName, Path
