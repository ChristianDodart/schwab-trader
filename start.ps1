# Starts the whole app: database + backend + frontend, then opens the dashboard.
# Usage:  right-click > Run with PowerShell   (or:  ./start.ps1  in a terminal)
$root = $PSScriptRoot

Write-Host "1/3  Starting database (Docker)..." -ForegroundColor Cyan
docker compose -f "$root\docker-compose.yml" up -d | Out-Null

Write-Host "2/3  Starting backend (Schwab + strategy)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit","-Command",
  "cd '$root\backend'; .\.venv\Scripts\python.exe run.py"
)

Write-Host "3/3  Starting frontend (dashboard)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
  "-NoExit","-Command",
  "cd '$root\frontend'; npm run dev"
)

Start-Sleep -Seconds 5
Write-Host "`nOpening http://localhost:5173 ..." -ForegroundColor Green
Start-Process "http://localhost:5173"
Write-Host "`nTwo terminal windows opened (backend + frontend). Close them or press" `
           "Ctrl+C in each to stop the app." -ForegroundColor DarkGray
