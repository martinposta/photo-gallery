@echo off
rem Double-click to start the gallery admin (opens in your browser).
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install || goto :error
)
call npm run admin
goto :eof

:error
echo.
echo Installation failed. Is Node.js installed? (https://nodejs.org)
pause
