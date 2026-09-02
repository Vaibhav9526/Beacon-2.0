$ErrorActionPreference = "Stop"

$adbPath = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path -LiteralPath $adbPath)) {
  throw "Android platform-tools were not found at $adbPath"
}

$connected = & $adbPath devices | Select-String -Pattern "\sdevice$"
if (-not $connected) {
  throw "No authorized Android device is connected over USB"
}

foreach ($port in 8000, 8081, 8084) {
  & $adbPath reverse "tcp:$port" "tcp:$port" | Out-Null
}

Write-Host "BEACON USB tunnel ready: API 8000, Metro 8081, auxiliary 8084"
& npm.cmd --workspace apps/mobile run start -- --dev-client --lan --port 8081
