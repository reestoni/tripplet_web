# TrippleT Web - put a new release on an instance, or go back (PowerShell as administrator on the VM).
#
#   .\update.ps1 -Instance test -Zip \\share\TrippleTWeb\releases\tripplet-web_20261114-1530_abc1234.zip
#   .\update.ps1 -Instance prod -Release tripplet-web_20261114-1530_abc1234   # same release as tested on "test"
#   .\update.ps1 -Instance prod -Rollback                                     # back to the previous release
#   .\update.ps1 -List                                                        # releases + what each instance runs
#
# Releases are kept side by side in C:\TrippleTWeb\releases (an instance only points at one via current.txt),
# so switching and going back take seconds. Users only notice a restart of about 10-20 s.
param(
  [string]$Instance = "",
  [string]$Zip = "",
  [string]$Release = "",
  [switch]$Rollback,
  [switch]$List,
  [int]$Keep = 8,                         # releases kept on disk (the ones in use always stay)
  [string]$Root = "C:\TrippleTWeb"
)
$ErrorActionPreference = "Stop"
$venvPy = "$Root\venv\Scripts\python.exe"

function Current($name) {
  $f = "$Root\instances\$name\current.txt"
  if (Test-Path $f) { (Get-Content $f | Select-Object -First 1).Trim() } else { "" }
}

if ($List) {
  Get-ChildItem "$Root\releases" -Directory | Sort-Object Name | ForEach-Object {
    $rt = "$($_.FullName)\web\RELEASE.txt"
    $info = if (Test-Path $rt) { (Get-Content $rt -Raw).Trim() } else { "" }
    Write-Host ("{0,-42} {1}" -f $_.Name, $info)
  }
  Get-ChildItem "$Root\instances" -Directory | ForEach-Object { Write-Host ("instance {0,-6} -> {1}" -f $_.Name, (Current $_.Name)) -ForegroundColor Cyan }
  return
}
if (-not $Instance) { throw "-Instance is required." }
$inst = "$Root\instances\$Instance"
if (-not (Test-Path "$inst\web.env")) { throw "Instance $Instance is not installed (run install.ps1)." }
$prev = Current $Instance

# which release?
if ($Rollback) {
  if (-not (Test-Path "$inst\previous.txt")) { throw "No previous release recorded." }
  $Release = (Get-Content "$inst\previous.txt" | Select-Object -First 1).Trim()
} elseif ($Zip) {
  if (-not (Test-Path $Zip)) { throw "ZIP not found: $Zip" }
  $Release = [IO.Path]::GetFileNameWithoutExtension($Zip)
  $dest = "$Root\releases\$Release"
  if (-not (Test-Path "$dest\web\backend\app\main.py")) {
    Write-Host "Unpacking $Release ..." -ForegroundColor Cyan
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Expand-Archive $Zip $dest
  }
} elseif (-not $Release) { throw "Give -Zip, -Release or -Rollback." }
$rel = "$Root\releases\$Release"
if (-not (Test-Path "$rel\web\backend\app\main.py")) { throw "Release not found: $rel" }

# Python packages of this release (quick when nothing changed)
Write-Host "Checking Python packages ..." -ForegroundColor Cyan
& $venvPy -m pip install --disable-pip-version-check -q -r "$rel\core\requirements.txt" -r "$rel\web\backend\requirements.txt"
if ($LASTEXITCODE -ne 0) { throw "pip install failed - instance not switched." }

# scripts: always the newest version of run_server/update/install
Copy-Item "$rel\web\deploy\server\*.ps1" "$Root\scripts\" -Force

# switch + restart
if ($prev -and $prev -ne $Release) { Set-Content -Encoding ascii "$inst\previous.txt" $prev }
Set-Content -Encoding ascii "$inst\current.txt" $Release
$svc = "TrippleTWeb-$Instance"
Write-Host "Restarting $svc ..." -ForegroundColor Cyan
Restart-Service $svc -Force -ErrorAction SilentlyContinue
if ((Get-Service $svc).Status -ne "Running") { Start-Service $svc }

# wait for the health check
$port = ((Get-Content "$inst\web.env" | Where-Object { $_ -match "^\s*TRIPPLET_WEB_PORT\s*=" }) -replace ".*=", "").Trim()
if (-not $port) { $port = "8000" }
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 5
    if ($h.ok) { $ok = $true; break }
  } catch { }
}
if ($ok) {
  Write-Host "OK: $Instance runs $($h.release) (mode $($h.mode), db $($h.db))" -ForegroundColor Green
} else {
  Write-Warning "No answer from http://127.0.0.1:$port/api/health - see $inst\logs\service.log"
  if ($prev -and $prev -ne $Release) { Write-Warning "Go back with: .\update.ps1 -Instance $Instance -Rollback" }
}

# tidy up: keep the newest $Keep releases plus every release an instance uses
$inUse = @(Get-ChildItem "$Root\instances" -Directory | ForEach-Object { Current $_.Name; if (Test-Path "$($_.FullName)\previous.txt") { (Get-Content "$($_.FullName)\previous.txt" | Select-Object -First 1).Trim() } })
Get-ChildItem "$Root\releases" -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep |
  Where-Object { $inUse -notcontains $_.Name } | ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
