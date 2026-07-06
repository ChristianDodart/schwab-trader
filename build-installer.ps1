# ============================================================================
# build-installer.ps1 — ONE command to produce the desktop installer.
#
#   .\build-installer.ps1              # build with the current version
#   .\build-installer.ps1 -SkipBackend # frontend-only change (reuses last exe)
#   .\build-installer.ps1 -Publish     # build AND push a GitHub release (auto-update)
#
# Steps: read version from backend/app/version.py → sync desktop/package.json →
# kill anything holding build outputs → vite build → PyInstaller → electron-builder
# → report the installer path + version. Fails loudly at the first broken step so
# a stale artifact can never ship silently (the root cause of the first-run bug).
#
# -Publish PREREQUISITES (auto-update pipeline — not yet set up as of v0.3.0):
#   1. Create a GitHub repo and fill desktop/package.json build.publish owner/repo
#      (they're placeholders "REPLACE_WITH_GH_OWNER/REPO" right now).
#   2. Set $env:GH_TOKEN to a token with 'repo' scope before running -Publish.
#   Without both, electron-updater has no feed and -Publish will fail — that's a
#   one-time maintainer setup, not a code task.
# ============================================================================
param(
    [switch]$SkipBackend,   # skip PyInstaller when only the frontend changed
    [switch]$SkipFrontend,  # skip vite when only the backend changed
    [switch]$Publish        # electron-builder --publish always (needs GH repo + GH_TOKEN)
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# --- version: single source = backend/app/version.py ---
$verLine = Get-Content "$root/backend/app/version.py" | Where-Object { $_ -match 'APP_VERSION\s*=\s*"([^"]+)"' }
if (-not $verLine) { throw "APP_VERSION not found in backend/app/version.py" }
$version = $Matches[1]
Write-Host "==> Building Schwab Trader v$version" -ForegroundColor Cyan

# sync desktop/package.json so the installer + auto-update manifest carry the same version
$pkgPath = "$root/desktop/package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($pkg.version -ne $version) {
    $pkg.version = $version
    ($pkg | ConvertTo-Json -Depth 10) + "`n" | Set-Content $pkgPath -Encoding utf8
    Write-Host "    synced desktop/package.json -> $version"
}

# --- kill anything that would lock build outputs ---
Get-Process -Name "Schwab Trader", "schwab-backend" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# --- frontend ---
if (-not $SkipFrontend) {
    Write-Host "==> Frontend (vite build)" -ForegroundColor Cyan
    npm --prefix "$root/frontend" run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
}

# --- backend exe ---
if (-not $SkipBackend) {
    Write-Host "==> Backend exe (PyInstaller)" -ForegroundColor Cyan
    Push-Location "$root/backend"   # the spec resolves paths from CWD
    try {
        & ".venv/Scripts/python.exe" -m PyInstaller schwab-backend.spec --noconfirm
        if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
    } finally { Pop-Location }
}

# --- installer ---
Write-Host "==> Installer (electron-builder)" -ForegroundColor Cyan
Push-Location "$root/desktop"
try {
    if ($Publish) {
        if (-not $env:GH_TOKEN) { throw "-Publish needs `$env:GH_TOKEN (a GitHub token with 'repo' scope)" }
        Write-Host "    publishing a GitHub release (auto-update feed)" -ForegroundColor Yellow
        npm run release   # electron-builder --publish always
    } else {
        npm run dist
    }
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
} finally { Pop-Location }

$installer = Get-ChildItem "$root/desktop/dist/*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ""
Write-Host "==> DONE: v$version" -ForegroundColor Green
Write-Host "    $($installer.FullName)"
Write-Host "    $([math]::Round($installer.Length/1MB,1)) MB · built $($installer.LastWriteTime)"
