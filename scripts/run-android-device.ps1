$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw 'Android Debug Bridge (adb) was not found. Install Android Studio Platform Tools and add platform-tools to PATH.'
}

$deviceLines = @(adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\S' })
$readyDevices = @($deviceLines | Where-Object { $_ -match '\sdevice$' })
if ($readyDevices.Count -eq 0) {
  throw 'No authorized Android device found. Connect it by USB, enable USB debugging, accept the RSA prompt, then retry.'
}

Write-Host "Found $($readyDevices.Count) authorized Android device(s). Building and installing NavDiret..."
npx expo run:android --device
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
