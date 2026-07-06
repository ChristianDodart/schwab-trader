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
# -Publish AUTO-UPDATE PIPELINE (set up as of v0.5.0):
#   Feed repo: ChristianDodart/schwab-trader (public), wired in desktop/package.json
#   build.publish. -Publish uploads the installer + latest.yml manifest to a GitHub
#   Release; installed copies then self-update via electron-updater on next launch.
#   Auth: uses $env:GH_TOKEN if set, else falls back to `gh auth token` (whichever
#   gh account is ACTIVE — make sure it's ChristianDodart, `gh auth switch` if not).
#   The token needs 'repo' scope.
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
        if (-not $env:GH_TOKEN) {
            # Fall back to the active gh account's token so releasing is one command.
            $env:GH_TOKEN = (gh auth token 2>$null)
            if (-not $env:GH_TOKEN) { throw "-Publish needs a token: set `$env:GH_TOKEN or run `gh auth login` (repo scope)" }
            $ghUser = (gh api user --jq .login 2>$null)
            Write-Host "    using gh token for account: $ghUser" -ForegroundColor DarkGray
        }
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
