# Groundworx Sidecar — Windows Service Installer
#
# Installs the Python FastAPI sidecar (uvicorn main:app) as a Windows service.
#
# Prerequisites:
#   1. Python 3.11 with sidecar deps installed (sidecar/.venv or system Python)
#   2. NSSM installed: winget install NSSM.NSSM
#   3. sidecar/.env configured (copy from sidecar/.env.example)
#   4. Run as Administrator from the repo root
#
# Usage:
#   cd <repo-root>
#   .\scripts\install-sidecar-service.ps1
#
# To uninstall:
#   nssm stop GroundworxSidecar
#   nssm remove GroundworxSidecar confirm

param(
    [int]   $Port       = 8001,
    [string]$PythonPath = ""
)

$RepoRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$SidecarDir = Join-Path $RepoRoot "sidecar"

if (-not (Test-Path (Join-Path $SidecarDir "main.py"))) {
    Write-Error "sidecar/main.py not found. Run from the repo root."
    exit 1
}

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Error "NSSM not found. Install with: winget install NSSM.NSSM"
    exit 1
}

# Prefer .venv inside sidecar, fall back to system Python
if (-not $PythonPath) {
    $venvPython = Join-Path $SidecarDir ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        $PythonPath = $venvPython
    } else {
        $PythonPath = (Get-Command python -ErrorAction SilentlyContinue)?.Source
    }
}
if (-not $PythonPath) { Write-Error "Python not found."; exit 1 }
Write-Host "Using Python: $PythonPath"

# Resolve uvicorn relative to the Python being used
$UvicornPath = Join-Path (Split-Path $PythonPath) "uvicorn.exe"
if (-not (Test-Path $UvicornPath)) {
    Write-Error "uvicorn not found alongside $PythonPath. Run: pip install uvicorn"
    exit 1
}

$LogDir = Join-Path $RepoRoot "logs\sidecar"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$ServiceName = "GroundworxSidecar"
$existing = nssm status $ServiceName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Stopping existing service..."
    nssm stop $ServiceName
    nssm remove $ServiceName confirm
}

Write-Host "Installing service $ServiceName..."
nssm install $ServiceName $UvicornPath "main:app --host 127.0.0.1 --port $Port"

nssm set $ServiceName AppDirectory   $SidecarDir
nssm set $ServiceName AppStdout      (Join-Path $LogDir "stdout.log")
nssm set $ServiceName AppStderr      (Join-Path $LogDir "stderr.log")
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 10485760
nssm set $ServiceName Start          SERVICE_AUTO_START
nssm set $ServiceName AppRestartDelay 5000

Write-Host "Starting service..."
nssm start $ServiceName
Start-Sleep 3

$status = nssm status $ServiceName
Write-Host "Service status: $status"

if ($status -match "RUNNING") {
    Write-Host ""
    Write-Host "Groundworx sidecar is running as a Windows service." -ForegroundColor Green
    Write-Host "  Health: http://localhost:$Port/health"
    Write-Host "  Logs:   $LogDir"
} else {
    Write-Warning "Service did not start. Check logs at $LogDir"
}
