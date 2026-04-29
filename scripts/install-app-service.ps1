# Groundworx App — Windows Service Installer
#
# Installs the Next.js app (npm start) as a persistent Windows service via NSSM.
# Runs the production build — run `npm run build` before installing.
#
# Prerequisites:
#   1. Node.js installed (node + npm on PATH)
#   2. NSSM installed: winget install NSSM.NSSM
#   3. .env.local configured (copy from .env.local.example and fill in values)
#   4. npm run build completed
#   5. Run as Administrator from the repo root
#
# Usage:
#   cd <repo-root>
#   npm run build
#   .\scripts\install-app-service.ps1
#
# To uninstall:
#   nssm stop GroundworxApp
#   nssm remove GroundworxApp confirm

param(
    [int]   $Port    = 3000,
    [string]$AppDir  = ""
)

if (-not $AppDir) { $AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent }

$NodePath = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $NodePath) { Write-Error "Node not found on PATH."; exit 1 }

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Error "NSSM not found. Install with: winget install NSSM.NSSM"
    exit 1
}

if (-not (Test-Path (Join-Path $AppDir ".next"))) {
    Write-Error ".next build directory not found. Run: npm run build"
    exit 1
}

if (-not (Test-Path (Join-Path $AppDir ".env.local"))) {
    Write-Warning ".env.local not found. Copy .env.local.example and fill in values before starting."
}

$NpmPath = (Get-Command npm -ErrorAction SilentlyContinue)?.Source
$LogDir  = Join-Path $AppDir "logs\app"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$ServiceName = "GroundworxApp"
$existing = nssm status $ServiceName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Stopping existing service..."
    nssm stop $ServiceName
    nssm remove $ServiceName confirm
}

Write-Host "Installing service $ServiceName..."
nssm install $ServiceName $NpmPath "start"

nssm set $ServiceName AppDirectory   $AppDir
nssm set $ServiceName AppStdout      (Join-Path $LogDir "stdout.log")
nssm set $ServiceName AppStderr      (Join-Path $LogDir "stderr.log")
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 10485760
nssm set $ServiceName Start          SERVICE_AUTO_START
nssm set $ServiceName AppRestartDelay 5000
nssm set $ServiceName AppEnvironmentExtra "PORT=$Port"

Write-Host "Starting service..."
nssm start $ServiceName
Start-Sleep 5

$status = nssm status $ServiceName
Write-Host "Service status: $status"

if ($status -match "RUNNING") {
    Write-Host ""
    Write-Host "Groundworx app is running as a Windows service." -ForegroundColor Green
    Write-Host "  Local:     http://localhost:$Port"
    Write-Host "  Tailscale: http://<your-tailscale-ip>:$Port"
    Write-Host "  Logs:      $LogDir"
} else {
    Write-Warning "Service did not start. Check logs at $LogDir"
}
