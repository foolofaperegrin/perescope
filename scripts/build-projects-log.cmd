@echo off
setlocal
cd /d "%~dp0.."
echo.
echo Projects build + log analysis
echo Log file: scripts\build-projects.log
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-projects-log.ps1"
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo Finished with errors ^(exit %ERR%^). See scripts\build-projects.log
  echo.
  pause
  exit /b %ERR%
)
echo All OK.
exit /b 0
