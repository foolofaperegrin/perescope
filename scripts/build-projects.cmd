@echo off
setlocal
cd /d "%~dp0.."
echo.
echo Projects build — updates projects\manifest.json for the main Projects page.
echo Log: scripts\build-projects.log
echo For build + error analysis use: scripts\build-projects-log.cmd
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-projects.ps1"
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo Build FAILED (exit %ERR%).
  echo.
  pause
  exit /b %ERR%
)
echo Done. hero.* = page top; cover.* = projects list tile; cover leads gallery.
exit /b 0
