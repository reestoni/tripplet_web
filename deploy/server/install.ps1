# TrippleT Web - one-time setup of an instance on the VM (PowerShell as administrator).
#
#   .\install.ps1 -Instance test -Port 8100 -Zip D:\drop\tripplet-web_....zip -ServiceUser "HEB\svc-tripplet"
#   .\install.ps1 -Instance prod -Port 8000 -Zip ...  -ServiceUser "HEB\svc-tripplet"
#
# Needs: Python 3.12 (py launcher or -Python path), nssm.exe (https://nssm.cc, -Nssm path),
#        C:\ProgramData\TrippleT\db_secrets.enc + secrets.enc (copied by hand, never in a release).
# Creates C:\TrippleTWeb\{venv, releases, scripts, instances\<name>\{web.env, logs, data}} and the
# Windows service "TrippleTWeb-<name>" (auto start, restart on failure), then installs the release.
param(
  [Parameter(Mandatory = $true)][string]$Instance,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][string]$Zip,
  [string]$ServiceUser = "",            # domain account with read/write on the TrippleT share; empty = LocalSystem
  [string]$Root = "C:\TrippleTWeb",
  [string]$Python = "",                 # e.g. C:\Program Files\Python312\python.exe (default: py -3.12)
  [string]$Nssm = "C:\TrippleTWeb\tools\nssm.exe"
)
$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run as administrator." }
if (-not (Test-Path $Nssm)) { throw "nssm.exe not found at $Nssm (download from nssm.cc, or pass -Nssm)." }
if (-not (Test-Path $Zip)) { throw "Release ZIP not found: $Zip" }

$inst = Join-Path $Root "instances\$Instance"
New-Item -ItemType Directory -Force "$Root\releases", "$Root\scripts", "$inst\logs", "$inst\data" | Out-Null

# 1) Python environment (shared by all instances)
$venvPy = "$Root\venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
  Write-Host "Creating Python environment ..." -ForegroundColor Cyan
  if ($Python) { & $Python -m venv "$Root\venv" } else { py -3.12 -m venv "$Root\venv" }
  if (-not (Test-Path $venvPy)) { throw "venv could not be created - is Python 3.12 installed?" }
}

# 2) settings of this instance
if (-not (Test-Path "$inst\web.env")) {
  $tmp = Join-Path $env:TEMP "tt_env_$Instance"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive $Zip $tmp
  $txt = Get-Content "$tmp\web\deploy\server\web.env.example" -Raw
  $txt = $txt -replace "(?m)^TRIPPLET_WEB_PORT=.*$", "TRIPPLET_WEB_PORT=$Port"
  $label = if ($Instance -eq "prod") { "" } else { $Instance }
  $txt = $txt -replace "(?m)^TRIPPLET_WEB_INSTANCE=.*$", "TRIPPLET_WEB_INSTANCE=$label"
  if ($Instance -eq "prod") { $txt = $txt -replace "(?m)^TRIPPLET_MODE=.*$", "TRIPPLET_MODE=prod" }
  Set-Content -Encoding utf8 "$inst\web.env" $txt
  Copy-Item "$tmp\web\deploy\server\*.ps1" "$Root\scripts\" -Force
  Remove-Item -Recurse -Force $tmp
  Write-Host "Created $inst\web.env - check it (mode, port, share) before the first start." -ForegroundColor Yellow
}
foreach ($f in @("db_secrets.enc", "secrets.enc")) {
  if (-not (Test-Path "C:\ProgramData\TrippleT\$f")) { Write-Warning "C:\ProgramData\TrippleT\$f is missing - the app cannot reach the DB." }
}

# 3) Windows service
$svc = "TrippleTWeb-$Instance"
if (-not (Get-Service $svc -ErrorAction SilentlyContinue)) {
  Write-Host "Creating service $svc ..." -ForegroundColor Cyan
  $ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  & $Nssm install $svc $ps "-NoProfile -ExecutionPolicy Bypass -File `"$Root\scripts\run_server.ps1`" -Instance $Instance -Root `"$Root`""
  & $Nssm set $svc DisplayName "TrippleT Web ($Instance)"
  & $Nssm set $svc Start SERVICE_AUTO_START
  & $Nssm set $svc AppStdout "$inst\logs\service.log"
  & $Nssm set $svc AppStderr "$inst\logs\service.log"
  & $Nssm set $svc AppRotateFiles 1
  & $Nssm set $svc AppRotateBytes 10485760
  & $Nssm set $svc AppExit Default Restart
  & $Nssm set $svc AppRestartDelay 5000
  if ($ServiceUser) {
    $cred = Get-Credential -UserName $ServiceUser -Message "Password of the service account"
    & $Nssm set $svc ObjectName $ServiceUser $cred.GetNetworkCredential().Password
  }
}

# 4) install the release (also starts the service)
& "$Root\scripts\update.ps1" -Instance $Instance -Zip $Zip -Root $Root
