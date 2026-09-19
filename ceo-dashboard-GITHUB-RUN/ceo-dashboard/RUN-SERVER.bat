@echo off
chcp 65001 >nul
title CEO Panel Server - 09017909857
color 0A
echo ========================================
echo   CEO Panel Server - باسلام واقعی
echo   شماره: 09017909857
echo ========================================
echo.

REM چک Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ❌ Node.js نصب نیست!
  echo.
  echo 1. برو https://nodejs.org
  echo 2. دکمه LTS را دانلود و نصب کن
  echo 3. دوباره این فایل را اجرا کن
  echo.
  pause
  start https://nodejs.org
  exit /b
)

echo ✅ Node.js: 
node --version
echo.

if not exist "node_modules" (
  echo 📦 نصب پکیج‌ها... (30 ثانیه)
  call npm install --silent
  echo ✅ نصب شد
  echo.
)

echo 🚀 سرور در حال ران...
echo.
echo   آدرس پنل: http://localhost:3000
echo   شماره مجاز: 09017909857
echo   باسلام: ✅ متصل (write)
echo.
echo   ⚠️ این پنجره را نبند - سرور باید روشن بماند
echo   برای خروج: Ctrl + C
echo.
echo ========================================
call npm start
pause
