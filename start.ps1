# TrippleT Web - built version: one process, FastAPI serves the built frontend on http://127.0.0.1:8000.
# Phase 1: always dev_local. Rebuild the frontend with: cd frontend; npm run build
$ErrorActionPreference = "Stop"
$py = "C:\Users\soj\AppData\Local\Programs\Python\Python312\python.exe"
$root = $PSScriptRoot
$env:TRIPPLET_MODE = "dev_local"
if (-not (Test-Path "$root\frontend\dist\index.html")) {
  Push-Location "$root\frontend"; npm.cmd run build; Pop-Location
}
Start-Job { Start-Sleep -Seconds 2; Start-Process "http://127.0.0.1:8000" } | Out-Null
Set-Location "$root\backend"
& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
