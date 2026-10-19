@echo off
rem Quick launch for Pixel Fixture Gen: installs dependencies on first run, then starts the dev server and opens the browser.
setlocal
cd /d "%~dp0"
title Pixel Fixture Gen

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies, first run only...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Pixel Fixture Gen at http://localhost:5179  (Ctrl+C to stop)
call npm run dev -- --port 5179 --open
pause
