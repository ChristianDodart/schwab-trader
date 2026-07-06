# Stops the app: backend, frontend, and (optionally) the database.
$root = $PSScriptRoot

Write-Host "Stopping backend (port 8000) and frontend (port 5173)..." -ForegroundColor Cyan
foreach ($port in 8000, 5173) {
  $pids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess |
          Select-Object -Unique
  foreach ($procId in $pids) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
}

# The database keeps running by default (it's cheap and your data lives there).
# Uncomment the next line if you also want to stop Postgres:
# docker compose -f "$root\docker-compose.yml" stop

Write-Host "App stopped. (Database left running — use 'docker compose stop' to halt it too.)" -ForegroundColor Green
