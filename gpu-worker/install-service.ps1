# Groundworx GPU Worker — Windows Service Installer
#
# Installs whisperx_server.py as a persistent Windows service using NSSM
# (Non-Sucking Service Manager). The service auto-starts on boot and restarts
# on crash, so the GPU worker is always available over Tailscale.
#
# Prerequisites:
#   1. Python 3.11 installed at C:\Users\<you>\AppData\Local\Programs\Python\Python311\
#   2. whisperx + pyannote installed in that Python (pip install whisperx pyannote.audio)
#   3. NSSM installed: winget install NSSM.NSSM
#   4. Run this script as Administrator from the gpu-worker directory
#
# Usage:
#   cd <path-to-gpu-worker>
#   .\install-service.ps1
#
# To uninstall:
#   nssm stop GroundworxGPU
#   nssm remove GroundworxGPU confirm

param(
    [string]$HfToken      = $env:HF_TOKEN,
    [string]$ApiKey       = "accurate",
    [string]$ModelSize    = "large-v2",
    [int]   $Port         = 8002,
    [string]$PythonPath   = ""
)

# ── Resolve paths ─────────────────────────────────────────────────────────────

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerScript = Join-Path $ScriptDir "whisperx_server.py"

if (-not (Test-Path $ServerScript)) {
    Write-Error "whisperx_server.py not found in $ScriptDir. Run this script from the gpu-worker directory."
    exit 1
}

# Locate Python
if (-not $PythonPath) {
    $candidates = @(
        (Get-Command python -ErrorAction SilentlyContinue)?.Source,
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "C:\Python311\python.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }
    if (-not $candidates) {
        Write-Error "Python not found. Install Python 3.11 or pass -PythonPath to this script."
        exit 1
    }
    $PythonPath = $candidates[0]
}
Write-Host "Using Python: $PythonPath"

# Check NSSM
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Error "NSSM not found. Install with: winget install NSSM.NSSM  (then restart this shell)"
    exit 1
}

if (-not $HfToken) {
    Write-Warning "HF_TOKEN not provided — speaker diarization will be disabled (no speaker labels)."
    Write-Warning "Get a token at https://huggingface.co/settings/tokens and rerun with -HfToken <token>"
}

# ── Install / update service ──────────────────────────────────────────────────

$ServiceName = "GroundworxGPU"
$LogDir = Join-Path $ScriptDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$existing = nssm status $ServiceName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Stopping existing service..."
    nssm stop $ServiceName
    nssm remove $ServiceName confirm
}

Write-Host "Installing service $ServiceName..."
nssm install $ServiceName $PythonPath $ServerScript

nssm set $ServiceName AppDirectory $ScriptDir
nssm set $ServiceName AppStdout (Join-Path $LogDir "stdout.log")
nssm set $ServiceName AppStderr (Join-Path $LogDir "stderr.log")
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 10485760   # 10 MB
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppRestartDelay 5000       # restart after 5s on crash

# Environment variables
$envBlock = "HF_TOKEN=$HfToken`nWHISPERX_API_KEY=$ApiKey`nWHISPERX_MODEL=$ModelSize`nPORT=$Port"
nssm set $ServiceName AppEnvironmentExtra $envBlock

Write-Host "Starting service..."
nssm start $ServiceName

Start-Sleep 3
$status = nssm status $ServiceName
Write-Host "Service status: $status"

if ($status -match "RUNNING") {
    Write-Host ""
    Write-Host "GPU worker is running as a Windows service." -ForegroundColor Green
    Write-Host "  Health check: http://localhost:$Port/health"
    Write-Host "  Tailscale URL: http://<your-tailscale-ip>:$Port"
    Write-Host "  Logs: $LogDir"
    Write-Host ""
    Write-Host "Set WHISPERX_URL=http://<tailscale-ip>:$Port in Groundworx Settings > Infrastructure"
} else {
    Write-Warning "Service did not start cleanly. Check logs at $LogDir"
}
