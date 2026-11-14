# TrippleT Web - started by the Windows service TrippleTWeb-<instance> (see install.ps1). Do not start by hand
# while the service runs (same port). Reads instances\<instance>\web.env and the active release (current.txt).
param([Parameter(Mandatory = $true)][string]$Instance, [string]$Root = "C:\TrippleTWeb")
$ErrorActionPreference = "Stop"
$inst = Join-Path $Root "instances\$Instance"
$envFile = Join-Path $inst "web.env"
if (-not (Test-Path $envFile)) { throw "Missing $envFile" }

foreach ($line in Get-Content $envFile) {
  $l = $line.Trim()
  if (-not $l -or $l.StartsWith("#")) { continue }
  $i = $l.IndexOf("=")
  if ($i -lt 1) { continue }
  [Environment]::SetEnvironmentVariable($l.Substring(0, $i).Trim(), $l.Substring($i + 1).Trim(), "Process")
}

$release = (Get-Content (Join-Path $inst "current.txt") -ErrorAction Stop | Select-Object -First 1).Trim()
$rel = Join-Path $Root "releases\$release"
if (-not (Test-Path "$rel\web\backend\app\main.py")) { throw "Release not found: $rel" }

# per-instance data: temp uploads (TDMS Inspector, Image Compare), session key
$data = Join-Path $inst "data"
New-Item -ItemType Directory -Force "$data\tmp" | Out-Null
$env:TEMP = "$data\tmp"; $env:TMP = "$data\tmp"
if (-not $env:TRIPPLET_WEB_SECRET_PATH) { $env:TRIPPLET_WEB_SECRET_PATH = "$data\web_secret.key" }
$env:TRIPPLET_CORE_PATH = "$rel\core"
$env:PYTHONDONTWRITEBYTECODE = "1"

# H: for this service process (the DB stores attachment folders as H:\...)
if ($env:TRIPPLET_MAP_DRIVE) {
  $parts = $env:TRIPPLET_MAP_DRIVE.Split("=", 2)
  $drive = $parts[0].Trim(); $unc = $parts[1].Trim()
  if (-not (Test-Path "$drive\")) {
    net use $drive $unc /persistent:no | Out-Null
    if (-not (Test-Path "$drive\")) { Write-Warning "Could not map $drive to $unc - attachments will be missing." }
  }
}

$port = if ($env:TRIPPLET_WEB_PORT) { $env:TRIPPLET_WEB_PORT } else { "8000" }
$py = Join-Path $Root "venv\Scripts\python.exe"
Write-Host "$(Get-Date -Format s) start $Instance release=$release mode=$env:TRIPPLET_MODE port=$port"
Set-Location "$rel\web\backend"
# ONE worker on purpose: open recycle-bin previews, Smart-Chart sessions and YarnScope analyses live in
# the server process. Only 127.0.0.1 - the HTTPS proxy on this VM is the only way in.
& $py -m uvicorn app.main:app --host 127.0.0.1 --port $port --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1
exit $LASTEXITCODE
