@echo off
REM CEO Panel - FIXED - handles spaces in path like "IRANIAN PC"
cd /d "%~dp0"
title CEO Panel Server - 09017909857
color 0A
echo ========================================
echo   CEO Panel Server - 09017909857
echo   Folder: %CD%
echo ========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js not found!
  echo Please install from https://nodejs.org (LTS)
  echo After install, close and reopen this file.
  pause
  start https://nodejs.org
  exit /b
)

echo Node version:
node --version
echo NPM version:
call npm --version
echo.

if not exist "node_modules" (
  echo Installing packages... (30 sec)
  call npm install --silent
  echo Done.
  echo.
)

echo Starting server...
echo Open: http://localhost:3000
echo Phone: 09017909857 - Code: 1234
echo.
echo DO NOT CLOSE THIS WINDOW
echo Press Ctrl+C to stop
echo ========================================
call npm start
pause
