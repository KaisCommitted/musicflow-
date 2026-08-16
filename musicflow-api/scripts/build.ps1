# Musicflow build script
# Builds the React frontend and packages everything with PyInstaller
param(
    [switch]$SkipFrontend,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dash = Join-Path $root "musicflow-dash"
$api = Join-Path $root "musicflow-api"

Write-Host "`n=== Musicflow Build ===" -ForegroundColor Cyan

# Step 1: Build frontend
if (-not $SkipFrontend) {
    Write-Host "`n[1/3] Building frontend..." -ForegroundColor Yellow
    Push-Location $dash
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
    Pop-Location
    Write-Host "  Frontend built -> musicflow-api/static/" -ForegroundColor Green
} else {
    Write-Host "`n[1/3] Skipping frontend build" -ForegroundColor DarkGray
}

# Step 2: PyInstaller
Write-Host "`n[2/3] Running PyInstaller..." -ForegroundColor Yellow
Push-Location $api
pyinstaller Musicflow.spec --noconfirm
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
Pop-Location
Write-Host "  Executable -> musicflow-api/dist/Musicflow.exe" -ForegroundColor Green

# Step 3: Inno Setup installer
if (-not $SkipInstaller) {
    Write-Host "`n[3/3] Building installer..." -ForegroundColor Yellow
    $iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    if (Test-Path $iscc) {
        & $iscc (Join-Path $api "installer.iss")
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
        Write-Host "  Installer -> musicflow-api/installer_output/" -ForegroundColor Green
    } else {
        Write-Host "  Inno Setup not found, skipping installer" -ForegroundColor DarkGray
    }
} else {
    Write-Host "`n[3/3] Skipping installer" -ForegroundColor DarkGray
}

Write-Host "`n=== Build complete ===`n" -ForegroundColor Cyan
