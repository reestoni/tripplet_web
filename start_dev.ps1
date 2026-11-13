# TrippleT Web - development: FastAPI (auto-reload) + Vite (hot reload), only on this PC (127.0.0.1).
# Phase 1: always dev_local.
$ErrorActionPreference = "Stop"
$py = "C:\Users\soj\AppData\Local\Programs\Python\Python312\python.exe"
$root = $PSScriptRoot
$env:TRIPPLET_MODE = "dev_local"

Start-Process -FilePath $py -WorkingDirectory "$root\backend" `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload", "--reload-dir", "app"
Start-Process -FilePath "npm.cmd" -WorkingDirectory "$root\frontend" -ArgumentList "run", "dev"
Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:5173"
