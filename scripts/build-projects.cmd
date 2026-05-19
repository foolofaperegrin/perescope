@echo off
setlocal
cd /d "%~dp0.."
echo.
echo Projects build — updates projects\manifest.json for the main Projects page.
echo.

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
  call npm run build:projects
  set ERR=%ERRORLEVEL%
) else (
  echo Node not found — falling back to PowerShell build.
  echo Log: scripts\build-projects.log
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-projects.ps1"
  set ERR=%ERRORLEVEL%
)

echo.
if %ERR% neq 0 (
  echo Build FAILED (exit %ERR%).
  echo.
  pause
  exit /b %ERR%
)
echo Done. hero.* = page top; cover.* = projects list tile; cover leads gallery.
exit /b 0
