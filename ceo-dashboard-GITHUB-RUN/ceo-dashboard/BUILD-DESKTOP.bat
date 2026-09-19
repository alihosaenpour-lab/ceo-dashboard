@echo off
echo ========================================
echo   ساخت فایل EXE دسکتاپ - CEO Panel
echo ========================================
echo مرحله 1: نصب Node.js از nodejs.org (اگر ندارید)
echo مرحله 2: این فایل را در پوشه ceo-dashboard اجرا کنید
echo.
pause
echo نصب پکیج‌ها...
call npm install
echo.
echo ساخت EXE ویندوز...
call npx electron-builder --win --publish never
echo.
echo ✅ تمام! فایل EXE در پوشه dist/ ساخته شد
echo    dist/CEO Panel Setup 2.0.0.exe
pause
