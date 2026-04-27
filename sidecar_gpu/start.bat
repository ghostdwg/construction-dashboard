@echo off
title NeuroGlitch GPU Worker
echo.
echo  NeuroGlitch GPU Worker
echo  WhisperX + Pyannote Diarization Service
echo  =========================================

if not exist ".env" (
    echo.
    echo  ERROR: .env not found.
    echo  Copy .env.example to .env and fill in your values.
    echo.
    pause
    exit /b 1
)

:: Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

:: Check for CUDA
python -c "import torch; print('CUDA:', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')" 2>nul
if errorlevel 1 (
    echo  WARNING: torch not installed or CUDA check failed.
    echo  Run: pip install torch --index-url https://download.pytorch.org/whl/cu121
)

echo.
echo  Starting on port 8002...
echo  Press Ctrl+C to stop.
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8002 --workers 1

pause
