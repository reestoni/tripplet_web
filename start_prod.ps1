# TrippleT Web - local tests against the PRODUCTION database (user's go 2026-11-16).
# Only on this PC (127.0.0.1), port 8010, next to start_dev.ps1 (dev_local, 8000/5173).
# Everything saved here is REAL data (change log under your name). Own login (own cookie), red "LOCAL · PROD" badge.
# Built version (one process): the frontend is rebuilt first so it matches the code.
$ErrorActionPreference = "Stop"
$py = "C:\Users\soj\AppData\Local\Programs\Python\Python312\python.exe"
$root = $PSScriptRoot
$env:TRIPPLET_MODE = "prod"
$env:TRIPPLET_WEB_ALLOW_PROD = "1"
$env:TRIPPLET_WEB_INSTANCE = "local"
Push-Location "$root\frontend"; npm.cmd run build; Pop-Location
Start-Job { Start-Sleep -Seconds 3; Start-Process "http://127.0.0.1:8010" } | Out-Null
Set-Location "$root\backend"
& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8010
