@echo off
setlocal
cd /d "%~dp0.."
set "LOG=%~dp0build-gallery.log"
echo.
echo Gallery build — log file:
echo   %LOG%
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-gallery.ps1"
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo Build FAILED (exit %ERR%). See log:
  echo   %LOG%
  echo.
  pause
  exit /b %ERR%
)
echo Done. Full transcript:
echo   %LOG%
exit /b 0
