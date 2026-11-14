# TrippleT Web - builds a release ZIP on the development PC (run in PowerShell from any folder).
#
#   .\deploy\build_release.ps1                      # -> C:\python\tripplet_releases\tripplet-web_<date>_<web>.zip
#   .\deploy\build_release.ps1 -OutDir "\\server\share\TrippleTWeb\releases"
#
# The ZIP holds exactly the COMMITTED state of both repos (git archive - no secrets, no local junk):
#   core\            tripplet_project (db/, ui/, assets/ ... the shared logic)
#   web\backend\     FastAPI
#   web\frontend\dist\  built frontend (npm run build)
#   web\deploy\      these scripts (the VM takes run_server.ps1 / update.ps1 from here)
#   web\RELEASE.txt  date + both commits (shown in the sidebar tooltip and /api/health)
param(
  [string]$OutDir = "C:\python\tripplet_releases",
  [string]$CorePath = "C:\python\tripplet_project",
  [switch]$AllowDirty,     # build although there are uncommitted changes (they are NOT in the ZIP)
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$web = Split-Path -Parent $PSScriptRoot
$py = "C:\Users\soj\AppData\Local\Programs\Python\Python312\python.exe"

function Git-Short($repo) { (git -C $repo rev-parse --short HEAD).Trim() }
function Git-Dirty($repo) { [bool](git -C $repo status --porcelain --untracked-files=no) }

foreach ($r in @($web, $CorePath)) {
  if (Git-Dirty $r) {
    if ($AllowDirty) { Write-Warning "$r has uncommitted changes - they are NOT part of the release." }
    else { throw "$r has uncommitted changes. Commit first (or use -AllowDirty)." }
  }
}
$webRev = Git-Short $web
$coreRev = Git-Short $CorePath
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$name = "tripplet-web_${stamp}_$webRev"

if (-not $SkipTests) {
  Write-Host "Backend tests (dev_local) ..." -ForegroundColor Cyan
  Push-Location "$web\backend"
  $env:TRIPPLET_MODE = "dev_local"
  & $py -m pytest -q
  $ok = $LASTEXITCODE -eq 0
  Pop-Location
  if (-not $ok) { throw "Backend tests failed - no release built." }
}

Write-Host "Frontend build ..." -ForegroundColor Cyan
Push-Location "$web\frontend"
npm.cmd run build
$ok = $LASTEXITCODE -eq 0
Pop-Location
if (-not $ok) { throw "Frontend build failed." }

$tmp = Join-Path $env:TEMP $name
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force "$tmp\core", "$tmp\web" | Out-Null

Write-Host "Packing committed files ..." -ForegroundColor Cyan
git -C $CorePath archive --format=zip -o "$tmp\core.zip" HEAD
git -C $web archive --format=zip -o "$tmp\web.zip" HEAD
Expand-Archive "$tmp\core.zip" "$tmp\core"
Expand-Archive "$tmp\web.zip" "$tmp\web"
Remove-Item "$tmp\core.zip", "$tmp\web.zip"
Copy-Item -Recurse "$web\frontend\dist" "$tmp\web\frontend\dist"
"$stamp | web $webRev | core $coreRev" | Set-Content -Encoding utf8 "$tmp\web\RELEASE.txt"

New-Item -ItemType Directory -Force $OutDir | Out-Null
$zip = Join-Path $OutDir "$name.zip"
Compress-Archive -Path "$tmp\*" -DestinationPath $zip -CompressionLevel Optimal
Remove-Item -Recurse -Force $tmp
Write-Host ""
Write-Host "Release: $zip" -ForegroundColor Green
Write-Host "On the VM:  C:\TrippleTWeb\scripts\update.ps1 -Instance test -Zip `"$zip`""
