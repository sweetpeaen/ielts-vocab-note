@echo off
cd /d %~dp0

rem Start the server in a minimized background window.
rem Keep window alive with /k so errors (e.g. port in use) stay visible.
start "IELTS-Vocab-Service" /min cmd /k "node server.js"

rem Wait ~2s for the server to come up (ping-based, avoids timeout PATH issues).
ping -n 3 127.0.0.1 >nul

rem Open the app in a dedicated app-style window (no tabs touched).
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%CHROME%" (
  start "" "%CHROME%" --app="http://localhost:3500"
) else if exist "%EDGE1%" (
  start "" "%EDGE1%" --app="http://localhost:3500"
) else if exist "%EDGE2%" (
  start "" "%EDGE2%" --app="http://localhost:3500"
) else (
  start "" "http://localhost:3500"
)

exit
